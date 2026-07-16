import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-weekly-"));
const mockPort = 18081;
const appPort = 3101;
const urlEntryAppPort = 3102;
const alice = "a3f0d748-5104-4703-a230-f5d3931a56b2";
const manager = "f7f12c63-49c0-4ed4-a032-216ea27ad9d2";
const director = "47d2767a-a540-43e2-a9f3-31c4835687d9";
const rollbackUser = "transaction-rollback-user";
const tenantId = "8133c675-3bb4-4ace-ba10-1e83299cf761";
const launchSecret = "integration-platform-launch-secret-123456789";
const children = [];
const sessionCookies = new Map();

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

async function sessionCookie(userId) {
  if (sessionCookies.has(userId)) return sessionCookies.get(userId);
  const launchResponse = await fetch(`http://localhost:${appPort}/auth/platform/launch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${launchSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: userId }),
  });
  const launch = await launchResponse.json();
  if (!launchResponse.ok) throw new Error(`Launch failed: ${launchResponse.status} ${launch.error?.message || ""}`);
  const consumeResponse = await fetch(launch.launch_url, { redirect: "manual" });
  if (consumeResponse.status !== 303) throw new Error(`Launch consume failed: ${consumeResponse.status}`);
  const cookie = String(consumeResponse.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("Launch consume did not create a session cookie");
  sessionCookies.set(userId, cookie);
  return cookie;
}

async function request(pathname, userId, options = {}) {
  const cookie = await sessionCookie(userId);
  const response = await fetch(`http://localhost:${appPort}${pathname}`, {
    ...options,
    headers: { Cookie: cookie, ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.error?.message || pathname}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

try {
  start(process.execPath, ["server.js"], path.join(root, "tools", "external-app-api-mock"), {
    PORT: String(mockPort),
    MOCK_STRICT_CONTRACT: "true",
    MOCK_ROLLBACK_USER_ID: rollbackUser,
  });
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  start(process.execPath, [tsxCli, "server/index.ts"], root, {
    PORT: String(appPort),
    NEXUSOS_API_BASE_URL: `http://localhost:${mockPort}/api/v1`,
    APP_PUBLIC_URL: `http://localhost:${appPort}`,
    PLATFORM_LAUNCH_SECRET: launchSecret,
    DATA_DIR: path.join(temp, "data"),
    UPLOAD_DIR: path.join(temp, "uploads"),
  });
  start(process.execPath, [tsxCli, "server/index.ts"], root, {
    PORT: String(urlEntryAppPort),
    PLATFORM_ENTRY_MODE: "url_user_id",
    NEXUSOS_API_BASE_URL: `http://localhost:${mockPort}/api/v1`,
    APP_PUBLIC_URL: `http://localhost:${urlEntryAppPort}`,
    DATA_DIR: path.join(temp, "url-entry-data"),
    UPLOAD_DIR: path.join(temp, "url-entry-uploads"),
  });
  await Promise.all([
    waitFor(`http://localhost:${mockPort}/health`),
    waitFor(`http://localhost:${appPort}/api/health`),
    waitFor(`http://localhost:${urlEntryAppPort}/api/health`),
  ]);

  const readyResponse = await fetch(`http://localhost:${appPort}/api/ready`);
  const ready = await readyResponse.json();
  assert(readyResponse.status === 200 && ready.database === "ok" && ready.uploads === "ok", "readiness should verify both SQLite and upload storage");

  const ticketModeUrlAttempt = await fetch(`http://localhost:${appPort}/?user_id=${encodeURIComponent(alice)}`, { redirect: "manual" });
  assert(ticketModeUrlAttempt.status === 200 && !ticketModeUrlAttempt.headers.get("set-cookie"), "ticket mode must ignore a browser-supplied URL user ID");

  const urlEntryResponse = await fetch(`http://localhost:${urlEntryAppPort}/?user_id=${encodeURIComponent(alice)}`, { redirect: "manual" });
  assert(urlEntryResponse.status === 303 && urlEntryResponse.headers.get("location") === "/", "url_user_id mode should exchange the query identity for a clean application URL");
  const urlEntryCookie = String(urlEntryResponse.headers.get("set-cookie") || "").split(";")[0];
  assert(urlEntryCookie, "url_user_id mode should create an HttpOnly application session");
  const urlEntrySessionResponse = await fetch(`http://localhost:${urlEntryAppPort}/api/session`, { headers: { Cookie: urlEntryCookie } });
  const urlEntrySession = await urlEntrySessionResponse.json();
  assert(urlEntrySessionResponse.status === 200 && urlEntrySession.current_user.id === alice, "the URL identity should resolve to the matching platform user session");
  const invalidUrlIdentity = await fetch(`http://localhost:${urlEntryAppPort}/?user_id=%00`, { redirect: "manual" });
  assert(invalidUrlIdentity.status === 400, "url_user_id mode should reject malformed user IDs");
  const disabledTicketEndpoint = await fetch(`http://localhost:${urlEntryAppPort}/auth/platform/launch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${launchSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: alice }),
  });
  assert(disabledTicketEndpoint.status === 404, "url_user_id mode should expose only the selected entry mechanism");

  const spoofedBrowserIdentity = await fetch(`http://localhost:${appPort}/api/session`, { headers: { "x-user-id": alice } });
  assert(spoofedBrowserIdentity.status === 401, "browser-supplied x-user-id must not authenticate without a platform session");
  const invalidLaunchCredential = await fetch(`http://localhost:${appPort}/auth/platform/launch`, {
    method: "POST",
    headers: { Authorization: "Bearer wrong-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: alice }),
  });
  assert(invalidLaunchCredential.status === 401, "platform launch must reject an invalid shared secret");
  const replayLaunchResponse = await fetch(`http://localhost:${appPort}/auth/platform/launch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${launchSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: alice }),
  });
  const replayLaunch = await replayLaunchResponse.json();
  assert(replayLaunchResponse.status === 201 && replayLaunch.launch_url, "platform launch should return a one-time URL");
  const firstConsume = await fetch(replayLaunch.launch_url, { redirect: "manual" });
  const replayConsume = await fetch(replayLaunch.launch_url, { redirect: "manual" });
  assert(firstConsume.status === 303 && replayConsume.status === 401, "a platform launch ticket must be consumable only once");

  const session = await request("/api/session", alice);
  assert(session.current_user.id === alice && !("users" in session), "the browser session should expose only its authenticated platform user");
  const displayUser2 = await request("/api/session", "2");
  assert(displayUser2.current_user.id === "2", "a simple platform user ID should resolve to its matching identity");

  let agentSettings = await request("/api/agent-settings", alice);
  assert(agentSettings.count === 3 && agentSettings.items.length === 3, "platform mock should expose multiple personal Agents for configuration");
  const metricsAgent = agentSettings.items.find((item) => item.agent_key === "weekly-metrics-agent");
  assert(metricsAgent, "the configurable metrics Agent should be returned by the platform list API");
  await request("/api/agent-settings", alice, { method: "PUT", body: JSON.stringify({ agent_id: metricsAgent.id }) });
  agentSettings = await request("/api/agent-settings", alice);
  assert(agentSettings.configured && agentSettings.selected_agent_id === metricsAgent.id, "selected Agent preference should persist for the current user");
  const foreignAgentPreference = await fetch(`http://localhost:${appPort}/api/agent-settings`, {
    method: "PUT",
    headers: { Cookie: await sessionCookie(alice), "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: "mock-agent-2-metrics" }),
  });
  assert(foreignAgentPreference.status === 403, "a user must not configure another user's Agent");

  const previousForm = new FormData();
  previousForm.set("week_start", "2026-07-06");
  previousForm.set("title", "第 28 周周报（计划对照基线）");
  previousForm.set("current_work", "完成平台接入方案评审。");
  previousForm.set("next_plan", "完成组织权限同步与 Agent 分析链路验证，并补充量化验收指标。");
  const previousReport = await request("/api/reports", alice, { method: "POST", body: previousForm });
  assert(previousReport.next_plan.includes("组织权限同步"), "the previous report should provide a plan-comparison baseline");

  const form = new FormData();
  form.set("week_start", "2026-07-13");
  form.set("title", "第 29 周周报（集成测试）");
  form.set("current_work", "完成组织权限同步与 Agent 分析链路验证。阻塞项：无。");
  form.set("next_plan", "完善生产环境配置并补充量化验收指标。");
  const expectedFilename = "项目进展清单.csv";
  form.append("attachments", new Blob(["测试附件：权限同步检查通过。"], { type: "text/csv" }), expectedFilename);
  const created = await request("/api/reports", alice, { method: "POST", body: form });
  assert(created.current_work.includes("组织权限同步") && created.next_plan.includes("生产环境配置"), "current work and next plan should be stored as separate report fields");
  assert(created.viewers.length === 3, "author, direct superior and indirect superior should have access");
  assert(created.attachments[0].original_name === expectedFilename, `Chinese attachment filename should round-trip unchanged; received ${created.attachments[0].original_name}`);
  assert(created.attachments[0].text_preview.includes("权限同步"), "attachment text should be extracted");

  const attachmentResponse = await fetch(`http://localhost:${appPort}/api/attachments/${created.attachments[0].id}/download`, {
    headers: { Cookie: await sessionCookie(manager) },
  });
  assert(attachmentResponse.status === 200, "an authorized reviewer should be able to download an attachment");
  assert((await attachmentResponse.text()).includes("权限同步检查通过"), "downloaded attachment bytes should match the uploaded Chinese content");
  assert(String(attachmentResponse.headers.get("content-disposition") || "").includes("filename*=UTF-8''"), "Chinese downloads should use an RFC 5987 filename");

  const unrelatedAttachment = await fetch(`http://localhost:${appPort}/api/attachments/${created.attachments[0].id}/download`, {
    headers: { Cookie: await sessionCookie("unrelated-user") },
  });
  assert(unrelatedAttachment.status === 403, "users outside the permission snapshot must not download attachments");

  const filesBeforeDuplicate = await fs.readdir(path.join(temp, "uploads"));
  const duplicate = new FormData();
  duplicate.set("week_start", "2026-07-13");
  duplicate.set("title", "不应覆盖的重复周报");
  duplicate.set("current_work", "这条记录必须被事务拒绝。");
  duplicate.set("next_plan", "原周报必须保持不变。");
  duplicate.append("attachments", new Blob(["duplicate"], { type: "text/plain" }), "重复附件.txt");
  const duplicateResponse = await fetch(`http://localhost:${appPort}/api/reports`, {
    method: "POST", headers: { Cookie: await sessionCookie(alice) }, body: duplicate,
  });
  assert(duplicateResponse.status === 409, "submitting the same week twice should be rejected as one transaction");
  const afterDuplicate = await request(`/api/reports/${created.id}`, alice);
  assert(afterDuplicate.title === created.title && afterDuplicate.attachments.length === 1, "a rejected duplicate must not partially replace the report or attachments");
  assert((await fs.readdir(path.join(temp, "uploads"))).length === filesBeforeDuplicate.length, "a rejected duplicate must clean up its staged attachment file");

  const rollbackForm = new FormData();
  rollbackForm.set("week_start", "2026-08-03");
  rollbackForm.set("title", "事务中途失败回滚测试");
  rollbackForm.set("current_work", "在报告写入后制造权限外键失败。");
  rollbackForm.set("next_plan", "验证数据库与附件均没有残留。");
  rollbackForm.append("attachments", new Blob(["rollback"], { type: "text/plain" }), "回滚附件.txt");
  const rollbackResponse = await fetch(`http://localhost:${appPort}/api/reports`, {
    method: "POST", headers: { Cookie: await sessionCookie(rollbackUser) }, body: rollbackForm,
  });
  assert(rollbackResponse.status === 500, "the injected mid-transaction foreign-key failure should surface as a server error");
  const rollbackReports = await request("/api/reports?scope=mine", rollbackUser);
  assert(rollbackReports.count === 0, "a mid-transaction failure must roll back the inserted report row");
  assert((await fs.readdir(path.join(temp, "uploads"))).length === filesBeforeDuplicate.length, "a mid-transaction failure must remove its staged attachment file");

  const managerQueue = await request("/api/reports?scope=review", manager);
  assert(managerQueue.items.some((item) => item.id === created.id), "direct superior should see the report");
  assert(managerQueue.items.find((item) => item.id === created.id).reviewer_comment_count === 0, "a report without the current reviewer's comment should be pending review");
  const directorQueue = await request("/api/reports?scope=review", director);
  assert(directorQueue.items.some((item) => item.id === created.id), "indirect superior should see the report");

  const keywordFiltered = await request(`/api/reports?scope=mine&q=${encodeURIComponent("阻塞项")}`, alice);
  assert(keywordFiltered.count === 1 && keywordFiltered.items[0].id === created.id, "keyword search should match report content");
  const authorFiltered = await request(`/api/reports?scope=review&author=${encodeURIComponent("Alice")}`, manager);
  assert(authorFiltered.items.some((item) => item.id === created.id), "review archive should filter reports by author name");
  const dateFiltered = await request("/api/reports?scope=review&from=2026-07-13&to=2026-07-13", manager);
  assert(dateFiltered.count === 1 && dateFiltered.items[0].id === created.id, "date range should include a matching report week");
  const outsideDate = await request("/api/reports?scope=review&from=2026-07-20&to=2026-07-27", manager);
  assert(outsideDate.count === 0, "date range should exclude reports outside the selected weeks");
  const unrelatedArchive = await request(`/api/reports?scope=review&q=${encodeURIComponent("阻塞项")}`, "unrelated-user");
  assert(unrelatedArchive.count === 0, "archive filters must not expose reports outside the viewer permission table");
  const invalidDateRange = await fetch(`http://localhost:${appPort}/api/reports?scope=mine&from=2026-07-20&to=2026-07-13`, { headers: { Cookie: await sessionCookie(alice) } });
  assert(invalidDateRange.status === 400, "inverted archive date ranges should be rejected");

  const firstComment = await request(`/api/reports/${created.id}/comments`, manager, { method: "POST", body: JSON.stringify({ content: "目标清楚，请在下周补充可量化的验收指标。" }) });
  const afterComment = await request(`/api/reports/${created.id}`, alice);
  assert(afterComment.comments.length === 1, "superior comment should be persisted");
  const reviewedManagerQueue = await request("/api/reports?scope=review", manager);
  assert(reviewedManagerQueue.items.find((item) => item.id === created.id).reviewer_comment_count === 1, "the report should become reviewed after the current reviewer comments");

  let messages = await request("/api/messages", alice);
  assert(messages.count === 1 && messages.unread_count === 1, "new superior comment should create one unread author message");
  assert(messages.items[0].report_id === created.id && messages.items[0].content.includes("可量化"), "message should identify its report and summarize the real comment");
  await request(`/api/messages/${firstComment.id}/read`, alice, { method: "POST", body: JSON.stringify({}) });
  messages = await request("/api/messages", alice);
  assert(messages.unread_count === 0 && messages.items[0].read_at, "opening a message should persist its read receipt");

  await request(`/api/reports/${created.id}/comments`, director, { method: "POST", body: JSON.stringify({ content: "建议同步补充风险应对人与完成时间。" }) });
  messages = await request("/api/messages", alice);
  assert(messages.count === 2 && messages.unread_count === 1, "a later superior comment should appear as a new unread message");
  await request("/api/messages/read-all", alice, { method: "POST", body: JSON.stringify({}) });
  messages = await request("/api/messages", alice);
  assert(messages.unread_count === 0 && messages.items.every((item) => item.read_at), "read all should persist read receipts for every message");

  let reviewerAnalysisJob = await request(`/api/reports/${created.id}/analyze`, manager, { method: "POST", body: JSON.stringify({}) });
  for (let count = 0; !["succeeded", "failed"].includes(reviewerAnalysisJob.status) && count < 40; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    reviewerAnalysisJob = await request(`/api/agent-jobs/${reviewerAnalysisJob.id}`, manager);
  }
  assert(reviewerAnalysisJob.status === "succeeded", `reviewer agent analysis should succeed; received ${reviewerAnalysisJob.status}: ${reviewerAnalysisJob.error || ""}`);
  assert(reviewerAnalysisJob.analysis?.answer, "reviewer Agent job should return its analysis");
  const afterReviewerAnalysis = await request(`/api/reports/${created.id}`, alice);
  assert(afterReviewerAnalysis.analyses.length === 1, "reviewer analysis should be persisted on the report");

  let analysisJob = await request(`/api/reports/${created.id}/analyze`, alice, { method: "POST", body: JSON.stringify({}) });
  for (let count = 0; !["succeeded", "failed"].includes(analysisJob.status) && count < 40; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    analysisJob = await request(`/api/agent-jobs/${analysisJob.id}`, alice);
  }
  assert(analysisJob.status === "succeeded", `author agent analysis should succeed; received ${analysisJob.status}: ${analysisJob.error || ""}`);
  assert(analysisJob.analysis?.answer, "completed Agent job should return its analysis");
  assert(analysisJob.analysis.answer.includes("目标与指标 Agent"), "author analysis should use the Agent saved in user preferences");
  assert(analysisJob.analysis.answer.includes("已接收分栏的本周工作与下周计划"), "Agent input should contain separate current_work and next_plan fields");
  assert(analysisJob.analysis.answer.includes("已接收上次计划与本次完成情况对照材料"), "Agent should receive an explicit previous-plan follow-up comparison");
  assert(typeof analysisJob.analysis.answer === "string" && !analysisJob.analysis.answer.trim().startsWith("{"), "Agent analysis should remain one plain-text answer for the existing result card");
  const afterAnalysis = await request(`/api/reports/${created.id}`, alice);
  assert(afterAnalysis.analyses.length === 2, "author and reviewer analyses should both be persisted");

  const forbidden = await fetch(`http://localhost:${appPort}/api/reports/${created.id}`, { headers: { Cookie: await sessionCookie("unrelated-user") } });
  assert(forbidden.status === 403, "unrelated users should be denied");
  const forbiddenAnalysis = await fetch(`http://localhost:${appPort}/api/reports/${created.id}/analyze`, { method: "POST", headers: { Cookie: await sessionCookie("unrelated-user"), "Content-Type": "application/json" }, body: "{}" });
  assert(forbiddenAnalysis.status === 403, "users without report access should not be able to start Agent analysis");

  const badAttachment = new FormData();
  badAttachment.set("week_start", "2026-07-27");
  badAttachment.set("title", "非法附件校验");
  badAttachment.set("current_work", "验证附件文件签名。");
  badAttachment.set("next_plan", "修复被识别的异常附件。");
  badAttachment.append("attachments", new Blob(["not a real pdf"], { type: "application/pdf" }), "伪造文件.pdf");
  const invalidUpload = await fetch(`http://localhost:${appPort}/api/reports`, { method: "POST", headers: { Cookie: await sessionCookie(alice) }, body: badAttachment });
  assert(invalidUpload.status === 400, "spoofed PDF attachment should be rejected");
  const afterInvalidUpload = await request("/api/reports?scope=mine&from=2026-07-27&to=2026-07-27", alice);
  assert(afterInvalidUpload.count === 0, "an invalid attachment must not leave a report row behind");
  assert((await fs.readdir(path.join(temp, "uploads"))).length === filesBeforeDuplicate.length, "an invalid attachment must not leave a staged file behind");

  const reviewerDelete = await fetch(`http://localhost:${appPort}/api/reports/${created.id}`, {
    method: "DELETE", headers: { Cookie: await sessionCookie(manager) },
  });
  assert(reviewerDelete.status === 403, "a reviewer must not be able to delete the author's report");

  const deleteResponse = await fetch(`http://localhost:${appPort}/api/reports/${created.id}`, { method: "DELETE", headers: { Cookie: await sessionCookie(alice) } });
  assert(deleteResponse.status === 204, "report author should be able to delete the report");
  const afterDelete = await request("/api/reports?scope=mine", alice);
  assert(!afterDelete.items.some((item) => item.id === created.id), "deleted report should disappear from the author's list");
  const messagesAfterDelete = await request("/api/messages", alice);
  assert(messagesAfterDelete.count === 0, "deleting a report should cascade to comments and message read receipts");
  const deletedAttachment = await fetch(`http://localhost:${appPort}/api/attachments/${created.attachments[0].id}/download`, {
    headers: { Cookie: await sessionCookie(alice) },
  });
  assert(deletedAttachment.status === 404, "deleting a report should cascade to attachment metadata");
  assert((await fs.readdir(path.join(temp, "uploads"))).length === 0, "deleting a report should remove its attachment file");

  const databaseModule = await import("better-sqlite3");
  const verificationDb = new databaseModule.default(path.join(temp, "data", "weekly.db"), { readonly: true });
  const foreignKeyViolations = verificationDb.pragma("foreign_key_check");
  const deletedRows = ["reports", "report_access", "attachments", "comments", "comment_reads", "agent_analyses", "agent_jobs"]
    .map((table) => Number(verificationDb.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === "comment_reads" ? "comment_id IN (SELECT id FROM comments WHERE report_id = ?)" : table === "report_access" || table === "attachments" || table === "comments" || table === "agent_analyses" || table === "agent_jobs" ? "report_id = ?" : "id = ?"}`).get(created.id).count));
  verificationDb.close();
  assert(foreignKeyViolations.length === 0, "SQLite foreign_key_check should report no integrity violations");
  assert(deletedRows.every((count) => count === 0), "report deletion should leave no report-owned relational rows");

  const platformRequestsResponse = await fetch(`http://localhost:${mockPort}/__test/requests`);
  const platformRequests = await platformRequestsResponse.json();
  assert(platformRequestsResponse.status === 200 && Array.isArray(platformRequests.items), "the platform mock should expose sanitized request evidence for contract verification");
  const externalRequests = platformRequests.items.filter((item) => item.path.startsWith("/api/v1/external-app/"));
  assert(externalRequests.length > 0 && externalRequests.every((item) => item.authorization_present && item.tenant_id === tenantId && item.app_key === "platform-api-tester" && item.user_id && item.request_id), "every platform API call should carry authentication, tenant, app, user and request identity headers");
  assert(externalRequests.some((item) => item.path === "/api/v1/external-app/context"), "the app should call the platform context API during launch");
  assert(externalRequests.some((item) => item.path === "/api/v1/external-app/organization-graph" && item.query_user_id === alice), "report submission should call organization-graph with the author user ID");
  const agentRunRequest = externalRequests.find((item) => /\/external-app\/agents\/[^/]+\/runs$/.test(item.path));
  assert(agentRunRequest?.method === "POST" && agentRunRequest.body_contract_valid, "Agent execution should use the documented run path and complete request body contract");
  assert(agentRunRequest.plan_follow_up_received && agentRunRequest.plain_text_requested, "Agent execution should request one text answer using the explicit prior-plan comparison material");
  assert(agentRunRequest.inject_memories === true && agentRunRequest.capture_memory === true, "Agent execution should inject the user's memories and allow the result to be written back to memory");

  const logoutCookie = await sessionCookie("logout-test-user");
  const logoutResponse = await fetch(`http://localhost:${appPort}/auth/logout`, { method: "POST", headers: { Cookie: logoutCookie } });
  assert(logoutResponse.status === 204, "logout should revoke the current application session");
  const afterLogout = await fetch(`http://localhost:${appPort}/api/session`, { headers: { Cookie: logoutCookie } });
  assert(afterLogout.status === 401, "a revoked session must not authenticate subsequent requests");

  console.log("Integration test passed: platform launch/session → strict platform API contract → Agent configuration → upload/download → transaction rollback → transitive permissions → archive filters → review/comments/messages → configured author/reviewer Agent → attachment validation → access denial → cascade deletion → logout");
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
