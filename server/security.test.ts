import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const originalEnvironment = { ...process.env };
let requestSecurity: typeof import("./security.js").requestSecurity;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    NEXUSOS_API_BASE_URL: "https://platform.example.test/api/v1",
    NEXUSOS_API_KEY: "test-key",
    NEXUSOS_TENANT_ID: "tenant-test",
    NEXUSOS_APP_KEY: "weekly-test",
    TRUSTED_PROXY_SECRET: "a-strong-test-only-proxy-secret-123456",
    CORS_ALLOWED_ORIGINS: "https://weekly.example.test",
    CLAMAV_HOST: "clamav.example.test",
  });
  ({ requestSecurity } = await import("./security.js"));
});

afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

function mocks(headers: Record<string, string>) {
  const req = {
    method: "GET",
    path: "/api/session",
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = { setHeader: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("production trusted identity", () => {
  it("accepts only the identity injected by a trusted proxy", () => {
    const { req, res, next } = mocks({
      "x-trusted-proxy-secret": "a-strong-test-only-proxy-secret-123456",
      "x-authenticated-user-id": "trusted-user",
      "x-user-id": "spoofed-browser-user",
    });
    requestSecurity(req, res, next);
    expect(req.authenticatedUserId).toBe("trusted-user");
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a request that does not come through the trusted proxy", () => {
    const { req, res, next } = mocks({ "x-authenticated-user-id": "trusted-user" });
    requestSecurity(req, res, next);
    expect(req.authenticatedUserId).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: "untrusted_proxy" }));
  });
});
