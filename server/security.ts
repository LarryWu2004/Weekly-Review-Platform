import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUserId?: string;
      requestId?: string;
    }
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requestSecurity(req: Request, res: Response, next: NextFunction) {
  const suppliedRequestId = String(req.header("x-request-id") || "");
  const requestId = suppliedRequestId.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${config.frameAncestors}`);

  if (req.method === "OPTIONS" || !req.path.startsWith("/api/") || req.path === "/api/health" || req.path === "/api/ready") return next();

  if (config.production) {
    const proxySecret = String(req.header(config.proxySecretHeader) || "");
    if (!proxySecret || !safeEqual(proxySecret, config.proxySecret)) {
      return next(new HttpError(401, "untrusted_proxy", "请求未通过可信身份网关"));
    }
  }

  const userId = String(req.header(config.identityHeader) || config.defaultUserId).trim();
  if (!userId) return next(new HttpError(401, "unauthenticated", "未获取到可信用户身份"));
  if (userId.length > 200 || /[\u0000-\u001f\u007f]/.test(userId)) return next(new HttpError(400, "invalid_identity", "用户身份格式无效"));
  req.authenticatedUserId = userId;
  next();
}

type RateEntry = { count: number; resetAt: number };
const rateEntries = new Map<string, RateEntry>();
let rateLimitRequests = 0;

export function rateLimit(limit: number, bucket: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    rateLimitRequests += 1;
    if (rateLimitRequests % 1000 === 0) {
      for (const [storedKey, stored] of rateEntries) if (stored.resetAt <= now) rateEntries.delete(storedKey);
      while (rateEntries.size > 50_000) rateEntries.delete(rateEntries.keys().next().value as string);
    }
    const identity = req.authenticatedUserId || req.ip || "anonymous";
    const key = `${bucket}:${identity}`;
    const current = rateEntries.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
    entry.count += 1;
    rateEntries.set(key, entry);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > limit) return next(new HttpError(429, "rate_limited", "请求过于频繁，请稍后重试"));
    next();
  };
}

export function userIdFrom(req: Request) {
  if (!req.authenticatedUserId) throw new HttpError(401, "unauthenticated", "未获取到可信用户身份");
  return req.authenticatedUserId;
}
