import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { normalizeMultipartFilename } from "./filenames.js";

const dataDir = config.dataDir;
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "weekly.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, author_user_id, week_start),
    FOREIGN KEY (author_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS report_access (
    tenant_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    viewer_user_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, report_id, viewer_user_id),
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (viewer_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    text_preview TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    commenter_user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (commenter_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS agent_analyses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    agent_run_id TEXT,
    status TEXT NOT NULL,
    answer TEXT NOT NULL,
    trace_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    analysis_id TEXT,
    error TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (analysis_id) REFERENCES agent_analyses(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

const quoteSql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hasColumn = (table: string, column: string) => (
  db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
).some((item) => item.name === column);

db.transaction(() => {
  const tables = ["users", "reports", "report_access", "attachments", "comments", "agent_analyses", "agent_jobs"];
  for (const table of tables) {
    if (!hasColumn(table, "tenant_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ${quoteSql(config.tenantId)}`);
    }
    db.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id = ''`).run(config.tenantId);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      request_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_tenant_author ON reports(tenant_id, author_user_id, week_start DESC);
    CREATE INDEX IF NOT EXISTS idx_access_tenant_viewer ON report_access(tenant_id, viewer_user_id, report_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_tenant_report ON attachments(tenant_id, report_id);
    CREATE INDEX IF NOT EXISTS idx_comments_tenant_report ON comments(tenant_id, report_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_tenant_report ON agent_analyses(tenant_id, report_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_tenant_report ON agent_jobs(tenant_id, report_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_events(tenant_id, created_at DESC);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
})();

const legacyAttachmentNames = db.prepare("SELECT id, original_name FROM attachments").all() as Array<{
  id: string;
  original_name: string;
}>;
const updateAttachmentName = db.prepare("UPDATE attachments SET original_name = ? WHERE id = ?");
db.transaction(() => {
  for (const attachment of legacyAttachmentNames) {
    const normalizedName = normalizeMultipartFilename(attachment.original_name);
    if (normalizedName !== attachment.original_name) updateAttachmentName.run(normalizedName, attachment.id);
  }
})();

export type PlatformUser = { id: string; name?: string; email?: string };

export function syncUsers(users: PlatformUser[]) {
  const statement = db.prepare(`
    INSERT INTO users (id, tenant_id, name, email, synced_at)
    VALUES (@id, @tenant_id, @name, @email, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      name = excluded.name,
      email = excluded.email,
      synced_at = excluded.synced_at
  `);
  const syncedAt = new Date().toISOString();
  db.transaction((items: PlatformUser[]) => {
    for (const user of items) {
      statement.run({
        id: user.id,
        tenant_id: config.tenantId,
        name: user.name || user.email || user.id,
        email: user.email || "",
        synced_at: syncedAt,
      });
    }
  })(users);
}

export function writeAudit(event: {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string;
  metadata?: Record<string, unknown>;
}) {
  db.prepare(`
    INSERT INTO audit_events (id, tenant_id, user_id, action, entity_type, entity_id, request_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), config.tenantId, event.userId, event.action, event.entityType,
    event.entityId || null, event.requestId || null, JSON.stringify(event.metadata || {}), new Date().toISOString(),
  );
}
