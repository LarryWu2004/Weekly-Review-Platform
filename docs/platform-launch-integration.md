# 平台启动周报协作应用

本应用不提供独立登录页，也不接受浏览器声明的用户 ID。用户必须先在 NexusOS 平台完成登录，再由平台服务端为该用户创建一次性应用启动地址。

> `external-app-api-reference..md` 规定的是本应用调用平台 API 的认证方式，没有规定平台跳转外部应用的 SSO 协议。本文件定义的是周报应用向平台开放的启动契约。

## 推荐流程：一次性启动票据

```text
已登录用户点击周报应用
  → NexusOS 服务端确认当前用户
  → NexusOS 服务端 POST /auth/platform/launch
  → 周报应用向 NexusOS /external-app/context 复核用户、租户和应用
  → 周报应用返回 2 分钟内有效的一次性 launch_url
  → NexusOS 将当前浏览器跳转到 launch_url
  → 周报应用消费票据，写入 HttpOnly 会话 Cookie
  → 浏览器进入周报主页面
```

### 1. 平台申请启动地址

```http
POST https://weekly.example.com/auth/platform/launch
Authorization: Bearer <PLATFORM_LAUNCH_SECRET>
Content-Type: application/json

{
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
  "redirect_path": "/"
}
```

要求：

- 此请求只能由 NexusOS 服务端发出，不能从浏览器调用。
- `PLATFORM_LAUNCH_SECRET` 是平台与周报应用共享的独立启动密钥，不是 `NEXUSOS_API_KEY`。
- `tenant_id` 必须与周报应用配置的 `NEXUSOS_TENANT_ID` 一致。
- `redirect_path` 可省略，只允许应用内以 `/` 开头的相对路径。

成功响应：

```json
{
  "launch_url": "https://weekly.example.com/auth/platform/consume?ticket=...",
  "expires_at": "2026-07-14T10:02:00.000Z"
}
```

### 2. 平台跳转当前浏览器

平台收到响应后，使用 HTTP 302 或前端 `location.assign(launch_url)` 将当前用户的浏览器跳转到 `launch_url`。不要在日志、分析事件或消息中长期保存该地址。

启动票据具有以下约束：

- 默认 120 秒过期，可通过 `LAUNCH_TICKET_TTL_SECONDS` 调整。
- 只能消费一次；重复访问会返回 401。
- 数据库只保存票据 SHA-256 摘要，不保存明文票据。
- 消费后创建 HttpOnly、SameSite=Lax 会话 Cookie；生产环境同时启用 Secure。
- 会话默认有效 8 小时，可通过 `SESSION_TTL_HOURS` 调整。

### 3. 平台服务端示例

```js
async function launchWeeklyReview({ tenantId, userId }) {
  const response = await fetch(`${process.env.WEEKLY_APP_URL}/auth/platform/launch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WEEKLY_PLATFORM_LAUNCH_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenant_id: tenantId, user_id: userId }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body.launch_url;
}
```

## 可选流程：可信反向代理

如果 NexusOS 通过自己的网关反向代理周报应用，可以不使用启动票据。网关必须：

1. 删除浏览器传入的 `x-authenticated-user-id` 和 `x-trusted-proxy-secret`。
2. 完成平台登录态校验。
3. 向周报应用注入真实 `x-authenticated-user-id`。
4. 注入双方约定的 `x-trusted-proxy-secret`。

应用只有在配置了 `TRUSTED_PROXY_SECRET` 时才启用此模式。不要把代理密钥放入浏览器、URL 或前端代码。

## 应用调用平台

用户会话建立后，周报应用服务端继续依据 `external-app-api-reference..md` 调用：

- `/external-app/context`：校验当前用户、租户与应用上下文。
- `/external-app/organization-graph`：获取直接、间接和多个上级。
- `/external-app/agents`：读取用户可调用 Agent。
- `/external-app/agents/{agent_id}/runs`：发起周报分析。

这些请求使用服务端保存的 `NEXUSOS_API_KEY`，并传递 `x-tenant-id`、`x-user-id` 和 `x-business-app-key`。浏览器不会接触平台 API Key。

## 生产配置

```env
NODE_ENV=production
APP_PUBLIC_URL=https://weekly.example.com
PLATFORM_LAUNCH_SECRET=<至少 32 位随机值>
SESSION_TTL_HOURS=8
LAUNCH_TICKET_TTL_SECONDS=120

NEXUSOS_API_BASE_URL=https://platform.example.com/api/v1
NEXUSOS_API_KEY=<平台分配的 API Key>
NEXUSOS_TENANT_ID=<租户 ID>
NEXUSOS_APP_KEY=<外部应用 Key>
```

平台侧需要保存：

```env
WEEKLY_APP_URL=https://weekly.example.com
WEEKLY_PLATFORM_LAUNCH_SECRET=<与应用一致的启动密钥>
```
