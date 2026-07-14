import path from "node:path";

function list(name: string) {
  return (process.env[name] || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function flag(name: string, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const production = process.env.NODE_ENV === "production";

function requiredInProduction(name: string, developmentFallback: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (production) throw new Error(`生产环境缺少必填配置：${name}`);
  return developmentFallback;
}

export const config = {
  production,
  port: Number(process.env.PORT || 3001),
  dataDir: path.resolve(process.env.DATA_DIR || "data"),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "uploads"),
  platformBaseUrl: requiredInProduction("NEXUSOS_API_BASE_URL", "http://localhost:18080/api/v1"),
  platformApiKey: requiredInProduction("NEXUSOS_API_KEY", "mock-api-key"),
  tenantId: requiredInProduction("NEXUSOS_TENANT_ID", "8133c675-3bb4-4ace-ba10-1e83299cf761"),
  appKey: requiredInProduction("NEXUSOS_APP_KEY", "platform-api-tester"),
  publicUrl: requiredInProduction("APP_PUBLIC_URL", "http://localhost:3001"),
  platformLaunchSecret: requiredInProduction("PLATFORM_LAUNCH_SECRET", "local-platform-launch-secret-change-before-production"),
  launchTicketTtlSeconds: Math.max(30, Number(process.env.LAUNCH_TICKET_TTL_SECONDS || 120)),
  sessionTtlHours: Math.max(1, Number(process.env.SESSION_TTL_HOURS || 8)),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "weekly_session",
  localTestEntry: !production && flag("ENABLE_LOCAL_TEST_ENTRY"),
  identityHeader: (process.env.TRUSTED_IDENTITY_HEADER || "x-authenticated-user-id").toLowerCase(),
  proxySecret: process.env.TRUSTED_PROXY_SECRET?.trim() || "",
  proxySecretHeader: (process.env.TRUSTED_PROXY_SECRET_HEADER || "x-trusted-proxy-secret").toLowerCase(),
  corsOrigins: list("CORS_ALLOWED_ORIGINS"),
  frameAncestors: process.env.FRAME_ANCESTORS || "'self'",
  platformTimeoutMs: Number(process.env.PLATFORM_TIMEOUT_MS || 20_000),
  generalRateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 180),
  agentRateLimitPerMinute: Number(process.env.AGENT_RATE_LIMIT_PER_MINUTE || 6),
  clamAvHost: production ? requiredInProduction("CLAMAV_HOST", "") : (process.env.CLAMAV_HOST || ""),
  clamAvPort: Number(process.env.CLAMAV_PORT || 3310),
  clamAvTimeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS || 15_000),
};

if (production && config.corsOrigins.length === 0) {
  throw new Error("生产环境缺少必填配置：CORS_ALLOWED_ORIGINS");
}
if (production && config.platformLaunchSecret.length < 32) {
  throw new Error("生产环境 PLATFORM_LAUNCH_SECRET 长度不能少于 32 位");
}
if (config.proxySecret && config.proxySecret.length < 32) {
  throw new Error("TRUSTED_PROXY_SECRET 长度不能少于 32 位");
}
if (production && new URL(config.publicUrl).protocol !== "https:") {
  throw new Error("生产环境 APP_PUBLIC_URL 必须使用 HTTPS");
}
