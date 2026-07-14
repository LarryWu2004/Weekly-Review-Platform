# NexusOS External App API Mock

这是给外部应用开发人员使用的本地 mock server。它不依赖 NexusOS 平台服务和数据库，使用 Node.js 内置 `http` 模块实现，接口路径、请求头和主要响应体结构与 `docs/external-app-api-reference.md` 保持一致。

## 启动

```powershell
cd tools/external-app-api-mock
npm start
```

默认地址：

```text
http://localhost:18080/api/v1
```

## 展示用户

mock 内置一条用于页面演示的组织链：`1 → 2 → 3`，其中箭头表示“下级 → 上级”。运行项目根目录的 `npm run seed:demo` 后：

| 用户 ID | 名称 | 本人周报 | 可审阅周报 |
| --- | --- | ---: | ---: |
| `1` | 展示用户 1 | 3 | 0 |
| `2` | 展示用户 2 | 0 | 3 |
| `3` | 展示用户 3 | 2 | 3 |

可以在周报应用的“本地模拟页面”中直接输入 `1`、`2` 或 `3` 查看三种身份视角。

健康检查：

```powershell
Invoke-RestMethod http://localhost:18080/health
```

## 可配置环境变量

```text
PORT=18080
MOCK_TENANT_ID=8133c675-3bb4-4ace-ba10-1e83299cf761
MOCK_APP_KEY=platform-api-tester
MOCK_USER_ID=a3f0d748-5104-4703-a230-f5d3931a56b2
MOCK_DATA_SOURCE_ID=c647bb88-4e05-4306-9646-2234c918bcd1
MOCK_AGENT_ID=2cc6e194-65ab-4096-a51a-99ccd05d662f
```

## 公共请求头

mock server 会校验 `x-business-app-key`，默认值为 `platform-api-tester`。`Authorization`、`x-tenant-id`、`x-user-id` 会被接受但不做真实鉴权。

```text
Authorization: Bearer mock-api-key
x-tenant-id: 8133c675-3bb4-4ace-ba10-1e83299cf761
x-business-app-key: platform-api-tester
Content-Type: application/json
```

## 已 mock 的 API

```text
GET  /api/v1/external-app/apis
GET  /api/v1/external-app/context
GET  /api/v1/external-app/organization-graph
GET  /api/v1/external-app/agents?user_id={user_id}
POST /api/v1/external-app/agents/{agent_id}/runs
GET  /api/v1/external-app/data-sources
GET  /api/v1/external-app/data-sources/{source_id}
POST /api/v1/external-app/structured-query/run
```

Agent 列表接口会为每个已知用户返回 3 个可选个人 Agent，用于验证外部应用的 Agent 配置和调用流程。

## PowerShell 示例

```powershell
$baseUrl = "http://localhost:18080/api/v1"
$headers = @{
  "Authorization" = "Bearer mock-api-key"
  "x-tenant-id" = "8133c675-3bb4-4ace-ba10-1e83299cf761"
  "x-business-app-key" = "platform-api-tester"
  "Content-Type" = "application/json"
}

Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/apis" -Headers $headers
Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/context" -Headers $headers
Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/organization-graph" -Headers $headers

$userId = "a3f0d748-5104-4703-a230-f5d3931a56b2"
$agents = Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/agents?user_id=$userId" -Headers $headers

$runBody = @{
  user_id = $userId
  objective = "请总结今天需要跟进的事项"
  input = @{ customer_id = "C001" }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$baseUrl/external-app/agents/$($agents.items[0].id)/runs" -Headers $headers -Body $runBody

$queryBody = @{
  source_id = "c647bb88-4e05-4306-9646-2234c918bcd1"
  sql = "select * from customers limit 20"
  execution_mode = "auto"
  max_rows = 50
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$baseUrl/external-app/structured-query/run" -Headers $headers -Body $queryBody
```

## JavaScript 示例

```js
const baseUrl = "http://localhost:18080/api/v1";
const headers = {
  Authorization: "Bearer mock-api-key",
  "x-tenant-id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "x-business-app-key": "platform-api-tester",
  "Content-Type": "application/json",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}

const context = await request("/external-app/context");
const agents = await request(`/external-app/agents?user_id=${encodeURIComponent(context.user_id)}`);
const run = await request(`/external-app/agents/${agents.items[0].id}/runs`, {
  method: "POST",
  body: JSON.stringify({
    user_id: context.user_id,
    objective: "请总结今天需要跟进的事项",
    input: { customer_id: "C001" },
  }),
});
console.log(run.answer);
```

## 与真实平台的差异

- mock server 不做真实 API Key 鉴权。
- mock server 不连接数据库、不调用真实 Agent。
- mock server 固定返回一组示例租户、用户、多个个人 Agent、数据源和组织关系。
- 对接真实平台时，以平台返回的 `/api/v1/external-app/apis` manifest 和实际授权配置为准。
