import path from "node:path";

function flag(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function list(name: string) {
  return (process.env[name] || "").split(",").map((value) => value.trim()).filter(Boolean);
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
  defaultUserId: production ? "" : (process.env.DEFAULT_USER_ID || "a3f0d748-5104-4703-a230-f5d3931a56b2"),
  identityHeader: (production ? (process.env.TRUSTED_IDENTITY_HEADER || "x-authenticated-user-id") : "x-user-id").toLowerCase(),
  proxySecret: production ? requiredInProduction("TRUSTED_PROXY_SECRET", "") : "",
  proxySecretHeader: (process.env.TRUSTED_PROXY_SECRET_HEADER || "x-trusted-proxy-secret").toLowerCase(),
  demoUserSwitcher: !production && flag("ENABLE_DEMO_USER_SWITCHER", true),
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
