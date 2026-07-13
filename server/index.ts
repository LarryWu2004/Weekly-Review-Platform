import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { db, syncUsers, writeAudit } from "./database.js";
import { extractText, isAllowedAttachmentName, validateAttachment } from "./attachments.js";
import { normalizeMultipartFilename } from "./filenames.js";
import { PlatformError, platform } from "./platform.js";
import { config } from "./config.js";
import { HttpError, rateLimit, requestSecurity, userIdFrom } from "./security.js";

const app = express();
const port = config.port;
const uploadDir = config.uploadDir;
fs.mkdirSync(uploadDir, { recursive: true });

function cleanupOrphanedUploads() {
  const referenced = new Set((db.prepare("SELECT storage_path FROM attachments").all() as Array<{ storage_path: string }>).map((item) => path.resolve(item.storage_path)));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}(\.[a-z0-9]+)?$/i.test(entry.name)) continue;
    const filePath = path.resolve(uploadDir, entry.name);
    try {
      if (!referenced.has(filePath) && fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", event: "orphan_cleanup_failed", path: filePath, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || !config.production || config.corsOrigins.includes(origin)) return callback(null, true);
    callback(new HttpError(403, "origin_not_allowed", "请求来源不在允许列表中"));
  },
}));
app.use(requestSecurity);
app.use("/api", rateLimit(config.generalRateLimitPerMinute, "api"));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => {
      file.originalname = normalizeMultipartFilename(file.originalname);
      callback(null, `${randomUUID()}${path.extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, callback) => {
    file.originalname = normalizeMultipartFilename(file.originalname);
    if (!isAllowedAttachmentName(file.originalname)) return callback(new HttpError(400, "unsupported_attachment", "仅支持文本、Excel、Word 和 PDF 附件"));
    callback(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const now = () => new Date().toISOString();
const isMonday = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
};

function canView(reportId: string, userId: string) {
  return Boolean(db.prepare(`
    SELECT 1 FROM reports r
    LEFT JOIN report_access ra ON ra.report_id = r.id AND ra.tenant_id = r.tenant_id AND ra.viewer_user_id = ?
    WHERE r.id = ? AND r.tenant_id = ? AND (r.author_user_id = ? OR ra.viewer_user_id IS NOT NULL)
  `).get(userId, reportId, config.tenantId, userId));
}

function reportDetail(reportId: string) {
  const report = db.prepare(`
    SELECT r.*, u.name AS author_name, u.email AS author_email
    FROM reports r JOIN users u ON u.id = r.author_user_id AND u.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ?
  `).get(reportId, config.tenantId) as Record<string, unknown> | undefined;
  if (!report) return null;
  return {
    ...report,
    attachments: db.prepare(`
      SELECT id, original_name, mime_type, size, text_preview, created_at
      FROM attachments WHERE report_id = ? AND tenant_id = ? ORDER BY created_at
    `).all(reportId, config.tenantId),
    comments: db.prepare(`
      SELECT c.*, u.name AS commenter_name, u.email AS commenter_email
      FROM comments c JOIN users u ON u.id = c.commenter_user_id AND u.tenant_id = c.tenant_id
      WHERE c.report_id = ? AND c.tenant_id = ? ORDER BY c.created_at ASC
    `).all(reportId, config.tenantId),
    viewers: db.prepare(`
      SELECT ra.viewer_user_id, ra.depth, ra.relation_type, u.name, u.email
      FROM report_access ra JOIN users u ON u.id = ra.viewer_user_id AND u.tenant_id = ra.tenant_id
      WHERE ra.report_id = ? AND ra.tenant_id = ? ORDER BY ra.depth, u.name
    `).all(reportId, config.tenantId),
    analyses: db.prepare(`
      SELECT * FROM agent_analyses WHERE report_id = ? AND tenant_id = ? ORDER BY created_at DESC
    `).all(reportId, config.tenantId),
  };
}

type AgentJob = {
  id: string;
  report_id: string;
  user_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  analysis_id: string | null;
  error: string | null;
  request_id: string | null;
  created_at: string;
  updated_at: string;
};

const scheduledAgentJobs = new Set<string>();

function agentJobDetail(jobId: string) {
  const job = db.prepare("SELECT * FROM agent_jobs WHERE id = ? AND tenant_id = ?").get(jobId, config.tenantId) as AgentJob | undefined;
  if (!job) return null;
  const analysis = job.analysis_id
    ? db.prepare("SELECT * FROM agent_analyses WHERE id = ? AND tenant_id = ?").get(job.analysis_id, config.tenantId)
    : null;
  return { ...job, analysis };
}

function scheduleAgentJob(jobId: string, delayMs = 0) {
  if (scheduledAgentJobs.has(jobId)) return;
  scheduledAgentJobs.add(jobId);
  const timer = setTimeout(() => {
    scheduledAgentJobs.delete(jobId);
    void processAgentJob(jobId);
  }, delayMs);
  timer.unref();
}

async function processAgentJob(jobId: string) {
  const claimed = db.prepare(`
    UPDATE agent_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND tenant_id = ? AND status = 'queued'
  `).run(now(), jobId, config.tenantId);
  if (!claimed.changes) return;

  const job = db.prepare("SELECT * FROM agent_jobs WHERE id = ? AND tenant_id = ?").get(jobId, config.tenantId) as AgentJob;
  try {
    const current = reportDetail(job.report_id) as (Record<string, unknown> & { author_user_id: string }) | null;
    if (!current || current.author_user_id !== job.user_id) throw new Error("周报不存在或任务发起人已失去权限");

    const historyReports = db.prepare(`
      SELECT id, week_start, title, content FROM reports
      WHERE tenant_id = ? AND author_user_id = ? AND id <> ? ORDER BY week_start DESC LIMIT 8
    `).all(config.tenantId, job.user_id, job.report_id) as Array<{ id: string; week_start: string; title: string; content: string }>;
    const history = historyReports.map((report) => ({
      week: report.week_start,
      title: report.title,
      content: report.content,
      comments: (db.prepare("SELECT content FROM comments WHERE report_id = ? AND tenant_id = ? ORDER BY created_at").all(report.id, config.tenantId) as Array<{ content: string }>).map((item) => item.content),
    }));
    const attachments = current.attachments as Array<{ original_name: string; text_preview: string }>;
    const comments = current.comments as Array<{ commenter_user_id: string; content: string }>;
    const agents = await platform.agents(job.user_id);
    if (!agents.items[0]) throw new Error("当前用户没有已绑定的个人 Agent");

    const run = await platform.runAgent(agents.items[0].id, job.user_id, {
      current_report: {
        title: current.title,
        content: current.content,
        attachments: attachments.map((item) => ({ file_name: item.original_name, text_preview: item.text_preview })),
      },
      history_reports: history,
      comments: comments.map((item) => ({ commenter_user_id: item.commenter_user_id, content: item.content })),
    });
    const analysisId = randomUUID();
    const timestamp = now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_analyses (id, tenant_id, report_id, agent_run_id, status, answer, trace_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(analysisId, config.tenantId, job.report_id, run.agent_run_id, run.status, run.answer, run.trace_id || null, timestamp);
      db.prepare(`
        UPDATE agent_jobs SET status = 'succeeded', analysis_id = ?, error = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(analysisId, timestamp, jobId, config.tenantId);
    })();
    writeAudit({ userId: job.user_id, action: "agent.succeeded", entityType: "agent_job", entityId: jobId, requestId: job.request_id || undefined, metadata: { report_id: job.report_id, analysis_id: analysisId } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Agent 分析失败";
    const retry = job.attempts < 3;
    db.prepare(`
      UPDATE agent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
    `).run(retry ? "queued" : "failed", message, now(), jobId, config.tenantId);
    if (retry) scheduleAgentJob(jobId, 750 * (2 ** (job.attempts - 1)));
    else writeAudit({ userId: job.user_id, action: "agent.failed", entityType: "agent_job", entityId: jobId, requestId: job.request_id || undefined, metadata: { report_id: job.report_id, error: message } });
  }
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "nexus-weekly" }));
app.get("/api/ready", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    fs.accessSync(uploadDir, fs.constants.R_OK | fs.constants.W_OK);
    res.json({ status: "ready", database: "ok", uploads: "ok" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

app.get("/api/session", asyncRoute(async (req, res) => {
  const userId = userIdFrom(req);
  const [context, graph] = await Promise.all([
    platform.context(userId),
    platform.organizationGraph(userId),
  ]);
  syncUsers(graph.users);
  const currentUser = graph.users.find((user) => user.id === userId) || {
    id: userId,
    name: userId,
    email: "",
  };
  syncUsers([currentUser]);

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM reports WHERE tenant_id = @tenantId AND author_user_id = @userId) AS mine,
      (SELECT COUNT(*) FROM report_access ra JOIN reports r ON r.id = ra.report_id
       WHERE ra.tenant_id = @tenantId AND r.tenant_id = @tenantId AND ra.viewer_user_id = @userId AND r.author_user_id <> @userId) AS review,
      (SELECT COUNT(*) FROM comments WHERE tenant_id = @tenantId AND commenter_user_id = @userId) AS comments
  `).get({ userId, tenantId: config.tenantId });

  res.json({
    current_user: currentUser,
    users: config.demoUserSwitcher ? graph.users : [currentUser],
    stats,
    demo_mode: config.demoUserSwitcher,
    capabilities: (context.external_app as { platform_capabilities?: string[] } | undefined)?.platform_capabilities || [],
  });
}));

app.get("/api/reports", (req, res) => {
  const userId = userIdFrom(req);
  const scope = String(req.query.scope || "all");
  const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
  const requestedOffset = Number.parseInt(String(req.query.offset || "0"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const condition = scope === "mine"
    ? "r.author_user_id = @userId"
    : scope === "review"
      ? "ra.viewer_user_id = @userId AND r.author_user_id <> @userId"
      : "r.author_user_id = @userId OR ra.viewer_user_id = @userId";
  const reports = db.prepare(`
    SELECT r.*, u.name AS author_name, u.email AS author_email, ra.depth AS viewer_depth,
      (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id AND c.tenant_id = r.tenant_id) AS comment_count,
      (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id AND a.tenant_id = r.tenant_id) AS attachment_count,
      (SELECT COUNT(*) FROM agent_analyses aa WHERE aa.report_id = r.id AND aa.tenant_id = r.tenant_id) AS analysis_count
    FROM reports r
    JOIN users u ON u.id = r.author_user_id AND u.tenant_id = r.tenant_id
    LEFT JOIN report_access ra ON ra.report_id = r.id AND ra.tenant_id = r.tenant_id AND ra.viewer_user_id = @userId
    WHERE r.tenant_id = @tenantId AND (${condition})
    ORDER BY r.week_start DESC, r.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ userId, tenantId: config.tenantId, limit, offset });
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS count
    FROM reports r
    LEFT JOIN report_access ra ON ra.report_id = r.id AND ra.tenant_id = r.tenant_id AND ra.viewer_user_id = @userId
    WHERE r.tenant_id = @tenantId AND (${condition})
  `).get({ userId, tenantId: config.tenantId }) as { count: number }).count;
  res.json({ items: reports, count: total, limit, offset, next_offset: offset + reports.length < total ? offset + reports.length : null });
});

app.get("/api/reports/:id", (req, res) => {
  const reportId = String(req.params.id);
  const userId = userIdFrom(req);
  if (!canView(reportId, userId)) return res.status(403).json({ error: { code: "forbidden", message: "你无权查看这份周报" } });
  const report = reportDetail(reportId);
  if (!report) return res.status(404).json({ error: { code: "not_found", message: "周报不存在" } });
  writeAudit({ userId, action: "report.view", entityType: "report", entityId: reportId, requestId: req.requestId });
  res.json(report);
});

app.post("/api/reports", upload.array("attachments", 5), asyncRoute(async (req, res) => {
  const authorUserId = userIdFrom(req);
  const title = String(req.body.title || "").trim();
  const content = String(req.body.content || "").trim();
  const weekStart = String(req.body.week_start || "").trim();
  const files = (req.files || []) as Express.Multer.File[];
  if (!title || title.length > 80 || !content || content.length > 50_000 || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !isMonday(weekStart)) {
    for (const file of files) fs.rmSync(file.path, { force: true });
    return res.status(400).json({ error: { code: "bad_request", message: "请填写有效的周起始日（周一）、标题和周报内容" } });
  }

  try {
    await Promise.all(files.map((file) => validateAttachment(file.path, file.originalname)));
  } catch (error) {
    for (const file of files) fs.rmSync(file.path, { force: true });
    throw new HttpError(400, "invalid_attachment", error instanceof Error ? error.message : "附件校验失败");
  }

  const graph = await platform.organizationGraph(authorUserId);
  syncUsers(graph.users);
  const author = graph.users.find((user) => user.id === authorUserId) || { id: authorUserId, name: authorUserId, email: "" };
  syncUsers([author]);
  const previews = await Promise.all(files.map((file) => extractText(file.path, file.originalname)));
  const reportId = randomUUID();
  const timestamp = now();

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO reports (id, tenant_id, author_user_id, week_start, title, content, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
      `).run(reportId, config.tenantId, authorUserId, weekStart, title, content, timestamp, timestamp);

      const access = db.prepare(`
        INSERT INTO report_access (tenant_id, report_id, viewer_user_id, depth, relation_type, granted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET
          depth = MIN(depth, excluded.depth), relation_type = excluded.relation_type
      `);
      access.run(config.tenantId, reportId, authorUserId, 0, "author", timestamp);
      for (const pathItem of graph.superior_paths.filter((item) => item.subordinate_user_id === authorUserId)) {
        access.run(config.tenantId, reportId, pathItem.supervisor_user_id, pathItem.depth, pathItem.depth === 1 ? "direct" : "indirect", timestamp);
      }

      const attachment = db.prepare(`
        INSERT INTO attachments (id, tenant_id, report_id, original_name, mime_type, size, storage_path, text_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      files.forEach((file, index) => {
        attachment.run(randomUUID(), config.tenantId, reportId, file.originalname, file.mimetype, file.size, file.path, previews[index], timestamp);
      });
    })();
  } catch (error) {
    for (const file of files) fs.rmSync(file.path, { force: true });
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: { code: "report_exists", message: "这一周已经提交过周报" } });
    }
    throw error;
  }

  writeAudit({
    userId: authorUserId, action: "report.create", entityType: "report", entityId: reportId, requestId: req.requestId,
    metadata: { week_start: weekStart, attachment_count: files.length },
  });
  res.status(201).json(reportDetail(reportId));
}));

app.delete("/api/reports/:id", (req, res) => {
  const reportId = String(req.params.id);
  const userId = userIdFrom(req);
  const report = db.prepare("SELECT author_user_id FROM reports WHERE id = ? AND tenant_id = ?").get(reportId, config.tenantId) as { author_user_id: string } | undefined;
  if (!report) return res.status(404).json({ error: { code: "not_found", message: "周报不存在" } });
  if (report.author_user_id !== userId) {
    return res.status(403).json({ error: { code: "forbidden", message: "只有周报作者可以删除周报" } });
  }

  const files = db.prepare("SELECT storage_path FROM attachments WHERE report_id = ? AND tenant_id = ?").all(reportId, config.tenantId) as Array<{ storage_path: string }>;
  db.transaction(() => {
    db.prepare("DELETE FROM reports WHERE id = ? AND tenant_id = ?").run(reportId, config.tenantId);
    writeAudit({ userId, action: "report.delete", entityType: "report", entityId: reportId, requestId: req.requestId, metadata: { attachment_count: files.length } });
  })();

  for (const file of files) {
    try {
      const resolved = path.resolve(file.storage_path);
      const uploadRoot = `${path.resolve(uploadDir)}${path.sep}`;
      if (resolved.startsWith(uploadRoot)) fs.rmSync(resolved, { force: true });
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", event: "attachment_cleanup_failed", report_id: reportId, path: file.storage_path, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  res.status(204).end();
});

app.post("/api/reports/:id/comments", (req, res) => {
  const reportId = String(req.params.id);
  const commenterUserId = userIdFrom(req);
  const content = String(req.body.content || "").trim();
  if (!content || content.length > 5000) return res.status(400).json({ error: { code: "bad_request", message: "评论内容不能为空且不能超过 5000 字" } });
  const report = db.prepare("SELECT author_user_id FROM reports WHERE id = ? AND tenant_id = ?").get(reportId, config.tenantId) as { author_user_id: string } | undefined;
  if (!report) return res.status(404).json({ error: { code: "not_found", message: "周报不存在" } });
  const access = db.prepare("SELECT depth FROM report_access WHERE report_id = ? AND tenant_id = ? AND viewer_user_id = ?").get(reportId, config.tenantId, commenterUserId) as { depth: number } | undefined;
  if (!access || access.depth === 0 || report.author_user_id === commenterUserId) {
    return res.status(403).json({ error: { code: "forbidden", message: "只有报告作者的上级可以评论" } });
  }
  const id = randomUUID();
  db.prepare("INSERT INTO comments (id, tenant_id, report_id, commenter_user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, config.tenantId, reportId, commenterUserId, content, now());
  const comment = db.prepare(`
    SELECT c.*, u.name AS commenter_name, u.email AS commenter_email
    FROM comments c JOIN users u ON u.id = c.commenter_user_id AND u.tenant_id = c.tenant_id WHERE c.id = ? AND c.tenant_id = ?
  `).get(id, config.tenantId);
  writeAudit({ userId: commenterUserId, action: "comment.create", entityType: "comment", entityId: id, requestId: req.requestId, metadata: { report_id: reportId } });
  res.status(201).json(comment);
});

app.post("/api/reports/:id/analyze", rateLimit(config.agentRateLimitPerMinute, "agent"), asyncRoute(async (req, res) => {
  const reportId = String(req.params.id);
  const userId = userIdFrom(req);
  const report = db.prepare("SELECT author_user_id FROM reports WHERE id = ? AND tenant_id = ?").get(reportId, config.tenantId) as { author_user_id: string } | undefined;
  if (!report) return res.status(404).json({ error: { code: "not_found", message: "周报不存在" } });
  if (report.author_user_id !== userId) {
    return res.status(403).json({ error: { code: "forbidden", message: "只有周报作者可以发起 Agent 分析" } });
  }

  const active = db.prepare(`
    SELECT id FROM agent_jobs
    WHERE tenant_id = ? AND report_id = ? AND user_id = ? AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 1
  `).get(config.tenantId, reportId, userId) as { id: string } | undefined;
  if (active) return res.status(202).json(agentJobDetail(active.id));

  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO agent_jobs (id, tenant_id, report_id, user_id, status, attempts, request_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)
  `).run(id, config.tenantId, reportId, userId, req.requestId || null, timestamp, timestamp);
  writeAudit({ userId, action: "agent.queued", entityType: "agent_job", entityId: id, requestId: req.requestId, metadata: { report_id: reportId } });
  scheduleAgentJob(id);
  res.status(202).json(agentJobDetail(id));
}));

app.get("/api/agent-jobs/:id", (req, res) => {
  const jobId = String(req.params.id);
  const userId = userIdFrom(req);
  const job = db.prepare("SELECT * FROM agent_jobs WHERE id = ? AND tenant_id = ?").get(jobId, config.tenantId) as AgentJob | undefined;
  if (!job) return res.status(404).json({ error: { code: "not_found", message: "分析任务不存在" } });
  if (job.user_id !== userId) return res.status(403).json({ error: { code: "forbidden", message: "无权查看此分析任务" } });
  res.json(agentJobDetail(jobId));
});

app.get("/api/attachments/:id/download", (req, res) => {
  const attachmentId = String(req.params.id);
  const userId = userIdFrom(req);
  const attachment = db.prepare("SELECT * FROM attachments WHERE id = ? AND tenant_id = ?").get(attachmentId, config.tenantId) as {
    report_id: string; storage_path: string; original_name: string;
  } | undefined;
  if (!attachment) return res.status(404).json({ error: { code: "not_found", message: "附件不存在" } });
  if (!canView(attachment.report_id, userId)) return res.status(403).json({ error: { code: "forbidden", message: "你无权下载该附件" } });
  writeAudit({ userId, action: "attachment.download", entityType: "attachment", entityId: attachmentId, requestId: req.requestId, metadata: { report_id: attachment.report_id } });
  res.download(attachment.storage_path, attachment.original_name);
});

const clientDist = path.resolve("dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = _req.requestId;
  console.error(JSON.stringify({
    level: "error",
    request_id: requestId,
    method: _req.method,
    path: _req.path,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message }, request_id: requestId });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: "upload_error", message: error.message }, request_id: requestId });
  }
  if (error instanceof PlatformError) {
    return res.status(502).json({ error: { code: error.code, message: `平台能力调用失败：${error.message}` }, request_id: requestId });
  }
  const message = config.production ? "服务器内部错误" : error instanceof Error ? error.message : "服务器内部错误";
  res.status(500).json({ error: { code: "internal_error", message }, request_id: requestId });
});

db.prepare("UPDATE agent_jobs SET status = 'queued', updated_at = ? WHERE tenant_id = ? AND status = 'running'")
  .run(now(), config.tenantId);
cleanupOrphanedUploads();
const pendingAgentJobs = db.prepare("SELECT id FROM agent_jobs WHERE tenant_id = ? AND status = 'queued'").all(config.tenantId) as Array<{ id: string }>;
for (const job of pendingAgentJobs) scheduleAgentJob(job.id);

app.listen(port, () => {
  console.log(`Nexus Weekly listening on http://localhost:${port}`);
});
