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
import { authorizePlatformLaunch, consumeLaunchTicket, createLaunchTicket, revokeSession, sessionCookieOptions, sessionUserId, validRedirectPath, validUserId } from "./auth.js";
import { composeReportContent } from "./report-content.js";

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
app.use((req, _res, next) => {
  req.authenticatedUserId = sessionUserId(req) || undefined;
  next();
});
app.use(requestSecurity);
app.use("/api", rateLimit(config.generalRateLimitPerMinute, "api"));
app.use(express.json({ limit: "2mb" }));

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.post("/auth/platform/launch", rateLimit(60, "platform-launch"), asyncRoute(async (req, res) => {
  if (config.platformEntryMode !== "ticket") {
    throw new HttpError(404, "not_found", "平台票据入口未启用");
  }
  if (!authorizePlatformLaunch(String(req.header("authorization") || ""))) {
    throw new HttpError(401, "invalid_launch_credential", "平台启动凭据无效");
  }
  if (String(req.body.tenant_id || "") !== config.tenantId) {
    throw new HttpError(403, "tenant_mismatch", "平台启动请求不属于当前租户");
  }
  const userId = validUserId(req.body.user_id);
  if (!userId) throw new HttpError(400, "invalid_identity", "平台用户身份格式无效");
  const context = await platform.context(userId) as { tenant_id?: string; user_id?: string; app?: { app_key?: string } };
  if (context.tenant_id !== config.tenantId || context.user_id !== userId || context.app?.app_key !== config.appKey) {
    throw new HttpError(403, "platform_context_mismatch", "平台返回的用户或应用上下文不匹配");
  }
  const redirectPath = validRedirectPath(req.body.redirect_path);
  const launch = createLaunchTicket(userId, redirectPath);
  writeAudit({ userId, action: "session.launch_created", entityType: "session", requestId: req.requestId });
  const launchUrl = new URL("/auth/platform/consume", config.publicUrl);
  launchUrl.searchParams.set("ticket", launch.ticket);
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json({ launch_url: launchUrl.toString(), expires_at: launch.expiresAt });
}));

app.get("/auth/platform/consume", (req, res) => {
  const ticket = String(req.query.ticket || "");
  const session = ticket ? consumeLaunchTicket(ticket) : null;
  if (!session) throw new HttpError(401, "invalid_launch_ticket", "启动链接无效、已使用或已过期");
  res.setHeader("Cache-Control", "no-store");
  res.cookie(config.sessionCookieName, session.sessionToken, sessionCookieOptions);
  writeAudit({ userId: session.userId, action: "session.started", entityType: "session", requestId: req.requestId });
  res.redirect(303, session.redirectPath);
});

app.get("/auth/local-test-entry", asyncRoute(async (req, res) => {
  const remoteAddress = req.socket.remoteAddress || "";
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!config.localTestEntry || !loopback) throw new HttpError(404, "not_found", "测试入口不可用");
  const userId = validUserId(req.query.user_id);
  if (!userId) throw new HttpError(400, "invalid_identity", "请提供有效的测试用户 ID");
  const context = await platform.context(userId) as { tenant_id?: string; user_id?: string; app?: { app_key?: string } };
  if (context.tenant_id !== config.tenantId || context.user_id !== userId || context.app?.app_key !== config.appKey) {
    throw new HttpError(403, "platform_context_mismatch", "平台返回的用户或应用上下文不匹配");
  }
  const launch = createLaunchTicket(userId, "/");
  const session = consumeLaunchTicket(launch.ticket);
  if (!session) throw new HttpError(500, "session_creation_failed", "测试会话创建失败");
  res.setHeader("Cache-Control", "no-store");
  res.cookie(config.sessionCookieName, session.sessionToken, sessionCookieOptions);
  writeAudit({ userId, action: "session.local_test_started", entityType: "session", requestId: req.requestId });
  res.redirect(303, "/");
}));

app.post("/auth/logout", (req, res) => {
  revokeSession(req);
  res.clearCookie(config.sessionCookieName, { ...sessionCookieOptions, maxAge: undefined });
  res.status(204).end();
});

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
    const current = reportDetail(job.report_id) as (Record<string, unknown> & { author_user_id: string; week_start: string; title: string; current_work: string; next_plan: string }) | null;
    if (!current || !canView(job.report_id, job.user_id)) throw new Error("周报不存在或任务发起人已失去权限");

    const historyReports = db.prepare(`
      SELECT id, week_start, title, current_work, next_plan FROM reports
      WHERE tenant_id = ? AND author_user_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 8
    `).all(config.tenantId, current.author_user_id, current.week_start) as Array<{ id: string; week_start: string; title: string; current_work: string; next_plan: string }>;
    const previousReport = historyReports[0] || null;
    const history = historyReports.map((report) => ({
      week: report.week_start,
      title: report.title,
      current_work: report.current_work,
      next_plan: report.next_plan,
      comments: (db.prepare("SELECT content FROM comments WHERE report_id = ? AND tenant_id = ? ORDER BY created_at").all(report.id, config.tenantId) as Array<{ content: string }>).map((item) => item.content),
    }));
    const attachments = current.attachments as Array<{ original_name: string; text_preview: string }>;
    const comments = current.comments as Array<{ commenter_user_id: string; content: string }>;
    const agents = await platform.agents(job.user_id);
    const preference = db.prepare(`
      SELECT selected_agent_id FROM user_agent_preferences WHERE tenant_id = ? AND user_id = ?
    `).get(config.tenantId, job.user_id) as { selected_agent_id: string } | undefined;
    const selectedAgent = agents.items.find((item) => item.id === preference?.selected_agent_id) || agents.items[0];
    if (!selectedAgent) throw new Error("当前用户没有已绑定的个人 Agent");

    const run = await platform.runAgent(selectedAgent.id, job.user_id, {
      current_report: {
        week: current.week_start,
        title: current.title,
        current_work: current.current_work,
        next_plan: current.next_plan,
        attachments: attachments.map((item) => ({ file_name: item.original_name, text_preview: item.text_preview })),
      },
      history_reports: history,
      previous_plan_follow_up: previousReport ? {
        previous_week: previousReport.week_start,
        previous_plan: previousReport.next_plan,
        current_week: current.week_start,
        current_work: current.current_work,
      } : null,
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
    writeAudit({ userId: job.user_id, action: "agent.succeeded", entityType: "agent_job", entityId: jobId, requestId: job.request_id || undefined, metadata: { report_id: job.report_id, analysis_id: analysisId, agent_id: selectedAgent.id } });
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
      (SELECT COUNT(*) FROM comments WHERE tenant_id = @tenantId AND commenter_user_id = @userId) AS comments,
      (SELECT COUNT(*)
       FROM comments c
       JOIN reports r ON r.id = c.report_id AND r.tenant_id = c.tenant_id
       LEFT JOIN comment_reads cr ON cr.comment_id = c.id AND cr.tenant_id = c.tenant_id AND cr.reader_user_id = @userId
       WHERE c.tenant_id = @tenantId AND r.author_user_id = @userId AND cr.comment_id IS NULL) AS unread_messages
  `).get({ userId, tenantId: config.tenantId });

  res.json({
    current_user: currentUser,
    stats,
    capabilities: (context.external_app as { platform_capabilities?: string[] } | undefined)?.platform_capabilities || [],
  });
}));

app.get("/api/messages", (req, res) => {
  const userId = userIdFrom(req);
  const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
  const requestedOffset = Number.parseInt(String(req.query.offset || "0"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const params = { userId, tenantId: config.tenantId, limit, offset };
  const items = db.prepare(`
    SELECT
      c.id,
      c.report_id,
      c.commenter_user_id,
      c.content,
      c.created_at,
      r.title AS report_title,
      r.week_start AS report_week_start,
      u.name AS commenter_name,
      u.email AS commenter_email,
      cr.read_at
    FROM comments c
    JOIN reports r ON r.id = c.report_id AND r.tenant_id = c.tenant_id
    JOIN users u ON u.id = c.commenter_user_id AND u.tenant_id = c.tenant_id
    LEFT JOIN comment_reads cr ON cr.comment_id = c.id AND cr.tenant_id = c.tenant_id AND cr.reader_user_id = @userId
    WHERE c.tenant_id = @tenantId AND r.author_user_id = @userId
    ORDER BY c.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS count,
      SUM(CASE WHEN cr.comment_id IS NULL THEN 1 ELSE 0 END) AS unread_count
    FROM comments c
    JOIN reports r ON r.id = c.report_id AND r.tenant_id = c.tenant_id
    LEFT JOIN comment_reads cr ON cr.comment_id = c.id AND cr.tenant_id = c.tenant_id AND cr.reader_user_id = @userId
    WHERE c.tenant_id = @tenantId AND r.author_user_id = @userId
  `).get(params) as { count: number; unread_count: number | null };
  res.json({
    items,
    count: counts.count,
    unread_count: counts.unread_count || 0,
    limit,
    offset,
    next_offset: offset + items.length < counts.count ? offset + items.length : null,
  });
});

app.post("/api/messages/read-all", (req, res) => {
  const userId = userIdFrom(req);
  const readAt = now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO comment_reads (tenant_id, comment_id, reader_user_id, read_at)
    SELECT c.tenant_id, c.id, @userId, @readAt
    FROM comments c
    JOIN reports r ON r.id = c.report_id AND r.tenant_id = c.tenant_id
    WHERE c.tenant_id = @tenantId AND r.author_user_id = @userId
  `).run({ userId, tenantId: config.tenantId, readAt });
  writeAudit({ userId, action: "message.read_all", entityType: "comment", requestId: req.requestId, metadata: { updated: result.changes } });
  res.json({ updated: result.changes, read_at: readAt });
});

app.post("/api/messages/:id/read", (req, res) => {
  const commentId = String(req.params.id);
  const userId = userIdFrom(req);
  const message = db.prepare(`
    SELECT c.id
    FROM comments c
    JOIN reports r ON r.id = c.report_id AND r.tenant_id = c.tenant_id
    WHERE c.id = ? AND c.tenant_id = ? AND r.author_user_id = ?
  `).get(commentId, config.tenantId, userId) as { id: string } | undefined;
  if (!message) return res.status(404).json({ error: { code: "not_found", message: "消息不存在" } });
  const readAt = now();
  db.prepare(`
    INSERT INTO comment_reads (tenant_id, comment_id, reader_user_id, read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, comment_id, reader_user_id) DO UPDATE SET read_at = excluded.read_at
  `).run(config.tenantId, commentId, userId, readAt);
  writeAudit({ userId, action: "message.read", entityType: "comment", entityId: commentId, requestId: req.requestId });
  res.json({ id: commentId, read_at: readAt });
});

app.get("/api/agent-settings", asyncRoute(async (req, res) => {
  const userId = userIdFrom(req);
  const result = await platform.agents(userId);
  const preference = db.prepare(`
    SELECT selected_agent_id, updated_at FROM user_agent_preferences WHERE tenant_id = ? AND user_id = ?
  `).get(config.tenantId, userId) as { selected_agent_id: string; updated_at: string } | undefined;
  const configuredAgent = preference && result.items.find((item) => item.id === preference.selected_agent_id);
  const selectedAgent = configuredAgent || result.items[0] || null;
  res.json({
    items: result.items,
    count: result.items.length,
    selected_agent_id: selectedAgent?.id || null,
    configured: Boolean(configuredAgent),
    updated_at: configuredAgent ? preference?.updated_at || null : null,
  });
}));

app.put("/api/agent-settings", asyncRoute(async (req, res) => {
  const userId = userIdFrom(req);
  const agentId = String(req.body.agent_id || "").trim();
  if (!agentId || agentId.length > 300) {
    return res.status(400).json({ error: { code: "bad_request", message: "请选择有效的 Agent" } });
  }
  const result = await platform.agents(userId);
  const selectedAgent = result.items.find((item) => item.id === agentId && item.owner_user_id === userId);
  if (!selectedAgent) {
    return res.status(403).json({ error: { code: "agent_not_accessible", message: "该 Agent 不在当前用户可调用列表中" } });
  }
  const updatedAt = now();
  db.prepare(`
    INSERT INTO user_agent_preferences (tenant_id, user_id, selected_agent_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, user_id) DO UPDATE SET
      selected_agent_id = excluded.selected_agent_id,
      updated_at = excluded.updated_at
  `).run(config.tenantId, userId, selectedAgent.id, updatedAt);
  writeAudit({ userId, action: "agent.preference.update", entityType: "agent", entityId: selectedAgent.id, requestId: req.requestId });
  res.json({ selected_agent_id: selectedAgent.id, selected_agent: selectedAgent, updated_at: updatedAt });
}));

app.get("/api/reports", (req, res) => {
  const userId = userIdFrom(req);
  const scope = String(req.query.scope || "all");
  const keyword = String(req.query.q || "").trim().slice(0, 100);
  const author = String(req.query.author || "").trim().slice(0, 100);
  const dateFrom = String(req.query.from || "").trim();
  const dateTo = String(req.query.to || "").trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((dateFrom && !datePattern.test(dateFrom)) || (dateTo && !datePattern.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return res.status(400).json({ error: { code: "bad_request", message: "请选择有效的周报起止日期" } });
  }
  const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
  const requestedOffset = Number.parseInt(String(req.query.offset || "0"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const condition = scope === "mine"
    ? "r.author_user_id = @userId"
    : scope === "review"
      ? "ra.viewer_user_id = @userId AND r.author_user_id <> @userId"
      : "r.author_user_id = @userId OR ra.viewer_user_id = @userId";
  const filterCondition = `
    (@keyword = '' OR r.title LIKE @keywordPattern OR r.current_work LIKE @keywordPattern OR r.next_plan LIKE @keywordPattern OR r.content LIKE @keywordPattern)
    AND (@author = '' OR u.name LIKE @authorPattern OR u.email LIKE @authorPattern OR r.author_user_id LIKE @authorPattern)
    AND (@dateFrom = '' OR r.week_start >= @dateFrom)
    AND (@dateTo = '' OR r.week_start <= @dateTo)
  `;
  const filterParams = {
    userId,
    tenantId: config.tenantId,
    keyword,
    keywordPattern: `%${keyword}%`,
    author,
    authorPattern: `%${author}%`,
    dateFrom,
    dateTo,
  };
  const listParams = { ...filterParams, limit, offset };
  const reports = db.prepare(`
    SELECT r.*, u.name AS author_name, u.email AS author_email, ra.depth AS viewer_depth,
      (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id AND c.tenant_id = r.tenant_id) AS comment_count,
      (SELECT COUNT(*) FROM comments rc
       WHERE rc.report_id = r.id AND rc.tenant_id = r.tenant_id AND rc.commenter_user_id = @userId) AS reviewer_comment_count,
      (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id AND a.tenant_id = r.tenant_id) AS attachment_count,
      (SELECT COUNT(*) FROM agent_analyses aa WHERE aa.report_id = r.id AND aa.tenant_id = r.tenant_id) AS analysis_count
    FROM reports r
    JOIN users u ON u.id = r.author_user_id AND u.tenant_id = r.tenant_id
    LEFT JOIN report_access ra ON ra.report_id = r.id AND ra.tenant_id = r.tenant_id AND ra.viewer_user_id = @userId
    WHERE r.tenant_id = @tenantId AND (${condition}) AND ${filterCondition}
    ORDER BY r.week_start DESC, r.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all(listParams);
  const total = (db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS count
    FROM reports r
    JOIN users u ON u.id = r.author_user_id AND u.tenant_id = r.tenant_id
    LEFT JOIN report_access ra ON ra.report_id = r.id AND ra.tenant_id = r.tenant_id AND ra.viewer_user_id = @userId
    WHERE r.tenant_id = @tenantId AND (${condition}) AND ${filterCondition}
  `).get(filterParams) as { count: number }).count;
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
  const currentWork = String(req.body.current_work || "").trim();
  const nextPlan = String(req.body.next_plan || "").trim();
  const content = composeReportContent(currentWork, nextPlan);
  const weekStart = String(req.body.week_start || "").trim();
  const files = (req.files || []) as Express.Multer.File[];
  if (!title || title.length > 80 || !currentWork || !nextPlan || currentWork.length > 30_000 || nextPlan.length > 20_000 || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !isMonday(weekStart)) {
    for (const file of files) fs.rmSync(file.path, { force: true });
    return res.status(400).json({ error: { code: "bad_request", message: "请填写有效的周起始日（周一）、标题、本周工作和下周计划" } });
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
        INSERT INTO reports (id, tenant_id, author_user_id, week_start, title, content, current_work, next_plan, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
      `).run(reportId, config.tenantId, authorUserId, weekStart, title, content, currentWork, nextPlan, timestamp, timestamp);

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
    return res.status(403).json({ error: { code: "forbidden", message: "只有具备审阅权限的成员可以评论" } });
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
  if (!canView(reportId, userId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "只有周报作者和具备查看权限的成员可以发起 Agent 分析" } });
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

app.get("/", rateLimit(60, "url-user-entry"), asyncRoute(async (req, res, next) => {
  if (config.platformEntryMode !== "url_user_id" || req.query.user_id === undefined) return next();
  const userId = validUserId(req.query.user_id);
  if (!userId) throw new HttpError(400, "invalid_identity", "URL 中的用户 ID 格式无效");

  const context = await platform.context(userId) as { tenant_id?: string; user_id?: string; app?: { app_key?: string } };
  if (context.tenant_id !== config.tenantId || context.user_id !== userId || context.app?.app_key !== config.appKey) {
    throw new HttpError(403, "platform_context_mismatch", "平台返回的用户或应用上下文不匹配");
  }

  const launch = createLaunchTicket(userId, "/");
  const session = consumeLaunchTicket(launch.ticket);
  if (!session) throw new HttpError(500, "session_creation_failed", "URL 用户会话创建失败");
  res.setHeader("Cache-Control", "no-store");
  res.cookie(config.sessionCookieName, session.sessionToken, sessionCookieOptions);
  writeAudit({ userId, action: "session.url_user_id_started", entityType: "session", requestId: req.requestId });
  res.redirect(303, "/");
}));

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
db.prepare("DELETE FROM platform_launch_tickets WHERE tenant_id = ? AND (expires_at <= ? OR consumed_at IS NOT NULL)").run(config.tenantId, now());
db.prepare("DELETE FROM app_sessions WHERE tenant_id = ? AND expires_at <= ?").run(config.tenantId, now());
cleanupOrphanedUploads();
const pendingAgentJobs = db.prepare("SELECT id FROM agent_jobs WHERE tenant_id = ? AND status = 'queued'").all(config.tenantId) as Array<{ id: string }>;
for (const job of pendingAgentJobs) scheduleAgentJob(job.id);

app.listen(port, () => {
  console.log(`Nexus Weekly listening on http://localhost:${port}`);
});
