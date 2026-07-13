import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-weekly-"));
const mockPort = 18081;
const appPort = 3101;
const alice = "a3f0d748-5104-4703-a230-f5d3931a56b2";
const manager = "f7f12c63-49c0-4ed4-a032-216ea27ad9d2";
const director = "47d2767a-a540-43e2-a9f3-31c4835687d9";
const children = [];

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url) {
  for (let count = 0; count < 60; count += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function request(pathname, userId, options = {}) {
  const response = await fetch(`http://localhost:${appPort}${pathname}`, {
    ...options,
    headers: { "x-user-id": userId, ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.error?.message || pathname}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

try {
  start(process.execPath, ["server.js"], path.join(root, "tools", "external-app-api-mock"), { PORT: String(mockPort) });
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  start(process.execPath, [tsxCli, "server/index.ts"], root, {
    PORT: String(appPort),
    NEXUSOS_API_BASE_URL: `http://localhost:${mockPort}/api/v1`,
    DATA_DIR: path.join(temp, "data"),
    UPLOAD_DIR: path.join(temp, "uploads"),
  });
  await Promise.all([waitFor(`http://localhost:${mockPort}/health`), waitFor(`http://localhost:${appPort}/api/health`)]);

  const session = await request("/api/session", alice);
  assert(session.users.length === 3, "platform users should be synchronized");

  const form = new FormData();
  form.set("week_start", "2026-07-13");
  form.set("title", "第 29 周周报（集成测试）");
  form.set("content", "完成组织权限同步与 Agent 分析链路验证。下周完善生产环境配置。阻塞项：无。");
  const expectedFilename = "项目进展清单.csv";
  form.append("attachments", new Blob(["测试附件：权限同步检查通过。"], { type: "text/csv" }), expectedFilename);
  const created = await request("/api/reports", alice, { method: "POST", body: form });
  assert(created.viewers.length === 3, "author, direct superior and indirect superior should have access");
  assert(created.attachments[0].original_name === expectedFilename, `Chinese attachment filename should round-trip unchanged; received ${created.attachments[0].original_name}`);
  assert(created.attachments[0].text_preview.includes("权限同步"), "attachment text should be extracted");

  const managerQueue = await request("/api/reports?scope=review", manager);
  assert(managerQueue.items.some((item) => item.id === created.id), "direct superior should see the report");
  const directorQueue = await request("/api/reports?scope=review", director);
  assert(directorQueue.items.some((item) => item.id === created.id), "indirect superior should see the report");

  await request(`/api/reports/${created.id}/comments`, manager, { method: "POST", body: JSON.stringify({ content: "目标清楚，请在下周补充可量化的验收指标。" }) });
  const afterComment = await request(`/api/reports/${created.id}`, alice);
  assert(afterComment.comments.length === 1, "superior comment should be persisted");

  let analysisJob = await request(`/api/reports/${created.id}/analyze`, alice, { method: "POST", body: JSON.stringify({}) });
  for (let count = 0; !["succeeded", "failed"].includes(analysisJob.status) && count < 40; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    analysisJob = await request(`/api/agent-jobs/${analysisJob.id}`, alice);
  }
  assert(analysisJob.status === "succeeded", `author agent analysis should succeed; received ${analysisJob.status}: ${analysisJob.error || ""}`);
  assert(analysisJob.analysis?.answer, "completed Agent job should return its analysis");
  const afterAnalysis = await request(`/api/reports/${created.id}`, alice);
  assert(afterAnalysis.analyses.length === 1, "analysis should be persisted");

  const forbidden = await fetch(`http://localhost:${appPort}/api/reports/${created.id}`, { headers: { "x-user-id": "unrelated-user" } });
  assert(forbidden.status === 403, "unrelated users should be denied");

  const badAttachment = new FormData();
  badAttachment.set("week_start", "2026-07-27");
  badAttachment.set("title", "非法附件校验");
  badAttachment.set("content", "此请求应被文件签名校验拒绝。");
  badAttachment.append("attachments", new Blob(["not a real pdf"], { type: "application/pdf" }), "伪造文件.pdf");
  const invalidUpload = await fetch(`http://localhost:${appPort}/api/reports`, { method: "POST", headers: { "x-user-id": alice }, body: badAttachment });
  assert(invalidUpload.status === 400, "spoofed PDF attachment should be rejected");

  const deleteResponse = await fetch(`http://localhost:${appPort}/api/reports/${created.id}`, { method: "DELETE", headers: { "x-user-id": alice } });
  assert(deleteResponse.status === 204, "report author should be able to delete the report");
  const afterDelete = await request("/api/reports?scope=mine", alice);
  assert(!afterDelete.items.some((item) => item.id === created.id), "deleted report should disappear from the author's list");
  console.log("Integration test passed: upload → transitive permissions → review → comment → async Agent → attachment validation → access denial → deletion");
} finally {
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 2000);
  })));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(temp, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
