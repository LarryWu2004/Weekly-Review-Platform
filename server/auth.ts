import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { db } from "./database.js";
import { config } from "./config.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const isoAfter = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString();

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookies(req: Request) {
  const result = new Map<string, string>();
  for (const part of String(req.header("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { result.set(key, decodeURIComponent(value)); } catch { /* ignore malformed cookies */ }
  }
  return result;
}

export function validUserId(value: unknown) {
  const userId = String(value || "").trim();
  if (!userId || userId.length > 200 || /[\u0000-\u001f\u007f]/.test(userId)) return null;
  return userId;
}

export function validRedirectPath(value: unknown) {
  const redirectPath = String(value || "/").trim();
  return redirectPath.startsWith("/") && !redirectPath.startsWith("//") ? redirectPath : "/";
}

export function authorizePlatformLaunch(authorization: string) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return Boolean(match?.[1] && safeEqual(match[1], config.platformLaunchSecret));
}

export function createLaunchTicket(userId: string, redirectPath = "/") {
  const ticket = newToken();
  const createdAt = new Date().toISOString();
  const expiresAt = isoAfter(config.launchTicketTtlSeconds * 1000);
  db.prepare("DELETE FROM platform_launch_tickets WHERE expires_at <= ? OR consumed_at IS NOT NULL").run(createdAt);
  db.prepare(`
    INSERT INTO platform_launch_tickets (token_hash, tenant_id, user_id, redirect_path, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(hashToken(ticket), config.tenantId, userId, validRedirectPath(redirectPath), expiresAt, createdAt);
  return { ticket, expiresAt };
}

export function consumeLaunchTicket(ticket: string) {
  const sessionToken = newToken();
  const sessionHash = hashToken(sessionToken);
  const consumedAt = new Date().toISOString();
  const sessionExpiresAt = isoAfter(config.sessionTtlHours * 60 * 60 * 1000);
  const result = db.transaction(() => {
    const launch = db.prepare(`
      SELECT user_id, redirect_path FROM platform_launch_tickets
      WHERE token_hash = ? AND tenant_id = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(hashToken(ticket), config.tenantId, consumedAt) as { user_id: string; redirect_path: string } | undefined;
    if (!launch) return null;
    const consumed = db.prepare(`
      UPDATE platform_launch_tickets SET consumed_at = ?
      WHERE token_hash = ? AND tenant_id = ? AND consumed_at IS NULL
    `).run(consumedAt, hashToken(ticket), config.tenantId);
    if (!consumed.changes) return null;
    db.prepare(`
      INSERT INTO app_sessions (token_hash, tenant_id, user_id, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionHash, config.tenantId, launch.user_id, sessionExpiresAt, consumedAt, consumedAt);
    return { userId: launch.user_id, redirectPath: launch.redirect_path };
  })();
  return result ? { ...result, sessionToken, expiresAt: sessionExpiresAt } : null;
}

export function sessionUserId(req: Request) {
  const token = cookies(req).get(config.sessionCookieName);
  if (!token) return null;
  const timestamp = new Date().toISOString();
  const session = db.prepare(`
    SELECT user_id, last_seen_at FROM app_sessions
    WHERE token_hash = ? AND tenant_id = ? AND expires_at > ?
  `).get(hashToken(token), config.tenantId, timestamp) as { user_id: string; last_seen_at: string } | undefined;
  if (!session) return null;
  if (Date.now() - new Date(session.last_seen_at).getTime() >= 5 * 60 * 1000) {
    db.prepare("UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ? AND tenant_id = ?")
      .run(timestamp, hashToken(token), config.tenantId);
  }
  return session.user_id;
}

export function revokeSession(req: Request) {
  const token = cookies(req).get(config.sessionCookieName);
  if (!token) return;
  db.prepare("DELETE FROM app_sessions WHERE token_hash = ? AND tenant_id = ?").run(hashToken(token), config.tenantId);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: "lax" as const,
  path: "/",
  maxAge: config.sessionTtlHours * 60 * 60 * 1000,
};
