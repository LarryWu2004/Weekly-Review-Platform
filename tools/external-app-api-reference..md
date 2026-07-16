# NexusOS External App API Reference

本文档面向外部应用开发者，说明如何从外部应用调用 NexusOS 平台已开放能力。开发者仅依赖本文档即可完成请求认证、能力发现、资源读取、组织关系读取、个人 Agent 调用和结构化只读查询接入。

当前 API 版本：`v1`

默认基础地址示例：

```text
http://localhost:8080/api/v1
```

生产环境请使用平台分配的 Control Plane 地址。

## 1. 接入模型

External App API 有两层授权：

1. 平台请求身份授权
   - 请求方需要通过平台安全上下文认证。
   - 推荐使用 `Authorization: Bearer <api_key>`。
   - 本地开发环境也支持用 `x-user-email` 或 `x-user-id` 代表当前用户。
   - 调用 `/api/v1/external-app/*` 需要平台权限 `data:read`。

2. 外部应用能力授权
   - 每个请求必须声明业务应用身份：`x-business-app-key`。
   - 该业务应用必须是 `runtime_provider = external_app`。
   - 业务应用绑定中的 `platform_capabilities` 决定可调用 API。
   - 业务应用绑定中的 `resource_bindings` 决定可访问资源，例如数据源、Agent。

示例业务应用绑定结构：

```json
{
  "runtime_provider": "external_app",
  "external_app": {
    "adapter_key": "external_app.api_tester.v1",
    "launch_mode": "api_tester",
    "platform_capabilities": [
      "resource.context.read",
      "organization.graph.read",
      "data_sources.list",
      "data_sources.read",
      "structured.query.run",
      "agents.list",
      "agents.run"
    ],
    "resource_bindings": {
      "data_sources": [
        {
          "source_id": "c647bb88-4e05-4306-9646-2234c918bcd1",
          "name": "示例CRM经营数据源"
        }
      ],
      "agents": [
        {
          "agent_id": "2cc6e194-65ab-4096-a51a-99ccd05d662f",
          "agent_key": "codex-dev-agent",
          "scope": "user",
          "owner_user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2"
        }
      ]
    }
  }
}
```

## 2. 公共请求规范

### 2.1 公共请求头

所有 External App API 都支持以下请求头：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 推荐 | 平台 API Key，格式 `Bearer <api_key>`。 |
| `x-tenant-id` | 推荐 | 租户 ID。生产环境建议明确传入。 |
| `x-user-id` | 可选 | 当前用户 ID。本地或用户态调用可传。 |
| `x-user-email` | 可选 | 当前用户邮箱。本地开发可用。 |
| `x-business-app-key` | 是 | 外部业务应用 Key，例如 `platform-api-tester`。 |
| `x-request-id` | 可选 | 调用方生成的请求 ID，便于排查。 |
| `x-trace-id` | 可选 | 调用链追踪 ID。 |
| `Content-Type` | POST 必填 | `application/json`。 |

`x-business-app-key` 也可以通过 `x-app-key` 或请求参数 `app_key` 传入，但对外集成建议统一使用 `x-business-app-key`。

### 2.2 公共响应头

平台会返回：

| Header | 说明 |
| --- | --- |
| `x-request-id` | 本次请求 ID。 |
| `x-trace-id` | 本次追踪 ID。 |
| `x-tenant-id` | 当前租户 ID。 |
| `x-user-id` | 当前用户 ID，如请求已解析到用户。 |

### 2.3 错误响应格式

所有错误统一返回：

```json
{
  "error": {
    "code": "capability_not_granted",
    "message": "external app capability is not granted: agents.run"
  },
  "request_id": "7face4b8-f8d1-44bc-8f54-63cbce5434fa",
  "trace_id": "a2e7e834-fe31-43a3-ad8d-7849d5b02e89"
}
```

常见状态码：

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `bad_request` | 请求参数不合法。 |
| 400 | `missing_app_key` | 缺少业务应用 Key。 |
| 400 | `missing_user_id` | 缺少 `user_id`。 |
| 400 | `missing_objective` | 调用 Agent 时缺少 `objective`。 |
| 403 | `forbidden` | 平台身份缺少基础权限，例如 `data:read`。 |
| 403 | `capability_not_granted` | 外部应用未开通对应能力。 |
| 403 | `resource_not_bound` | 资源未绑定到当前外部应用。 |
| 403 | `agent_not_accessible` | Agent 不属于传入用户。 |
| 404 | `app_not_found` | 业务应用不存在。 |
| 404 | `not_found` | 资源不存在。 |
| 409 | `not_external_app` | 业务应用不是外部应用。 |
| 409 | `wrong_data_source_type` | 数据源类型不支持结构化查询。 |
| 502 | `data_source_connection_failed` | 数据源数据库连接失败。 |

## 3. 能力发现 API

### 3.1 获取当前应用可调用 API 清单

```http
GET /api/v1/external-app/apis
x-business-app-key: platform-api-tester
```

需要 capability：

```text
resource.context.read
```

curl 示例：

```bash
curl -X GET "http://localhost:8080/api/v1/external-app/apis" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester"
```

响应示例：

```json
{
  "contract": "external_app.api_manifest.v1",
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "app_key": "platform-api-tester",
  "items": [
    {
      "key": "context",
      "name": "运行上下文",
      "method": "GET",
      "path": "/api/v1/external-app/context",
      "capability": "resource.context.read",
      "description": "读取当前租户、用户、业务应用绑定和能力声明。",
      "params": [
        {
          "key": "app_key",
          "label": "业务应用 Key",
          "type": "app_key",
          "in": "header",
          "header": "x-business-app-key",
          "required": true
        }
      ]
    }
  ],
  "count": 1,
  "trace_id": "..."
}
```

说明：

- `items` 只包含当前业务应用已授权的 API。
- 外部应用可用该接口动态渲染 API 调试台或能力选择界面。

## 4. 运行上下文 API

### 4.1 获取当前外部应用上下文

```http
GET /api/v1/external-app/context
x-business-app-key: platform-api-tester
```

需要 capability：

```text
resource.context.read
```

响应示例：

```json
{
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
  "app": {
    "app_key": "platform-api-tester",
    "name": "平台 API 测试台",
    "status": "active",
    "runtime_provider": "external_app"
  },
  "external_app": {
    "adapter_key": "external_app.api_tester.v1",
    "launch_mode": "api_tester",
    "entry_url": null,
    "api_base_url": null,
    "platform_capabilities": [
      "resource.context.read",
      "data_sources.list",
      "data_sources.read"
    ]
  },
  "resources": {
    "data_sources": [
      {
        "source_id": "c647bb88-4e05-4306-9646-2234c918bcd1",
        "name": "示例CRM经营数据源"
      }
    ]
  },
  "trace_id": "..."
}
```

## 5. 组织关系 API

### 5.1 获取组织关系图

```http
GET /api/v1/external-app/organization-graph
x-business-app-key: platform-api-tester
```

需要 capability：

```text
organization.graph.read
```

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_id` | 否 | 指定后只返回该用户的传递上级闭包。 |

示例：

```bash
curl -X GET "http://localhost:8080/api/v1/external-app/organization-graph?user_id=$USER_ID" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester"
```

响应示例：

```json
{
  "contract": "external_app.organization_graph.v1",
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "app_key": "platform-api-tester",
  "users": [
    {
      "id": "user-1",
      "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
      "email": "alice@example.com",
      "name": "Alice",
      "status": "active",
      "metadata": {},
      "roles": []
    }
  ],
  "relations": [
    {
      "id": "relation-1",
      "supervisor_user_id": "manager-user-id",
      "subordinate_user_id": "user-1",
      "relation_type": "direct",
      "status": "active",
      "metadata": {},
      "supervisor": {
        "id": "manager-user-id",
        "name": "Manager",
        "email": "manager@example.com"
      },
      "subordinate": {
        "id": "user-1",
        "name": "Alice",
        "email": "alice@example.com"
      }
    }
  ],
  "superior_paths": [
    {
      "subordinate_user_id": "user-1",
      "supervisor_user_id": "manager-user-id",
      "depth": 1,
      "subordinate": {
        "id": "user-1",
        "name": "Alice",
        "email": "alice@example.com"
      },
      "supervisor": {
        "id": "manager-user-id",
        "name": "Manager",
        "email": "manager@example.com"
      }
    }
  ],
  "counts": {
    "users": 1,
    "relations": 1,
    "superior_paths": 1
  },
  "trace_id": "..."
}
```

说明：

- 用户可以有多个直接上级。
- `superior_paths` 包含传递上级关系，上级的上级也会出现在结果中。

## 6. Agent API

Agent API 当前仅开放“用户个人 Agent”。平台 Agent / system Agent 暂不通过 External App API 开放。

### 6.1 获取用户可调用 Agent 列表

```http
GET /api/v1/external-app/agents?user_id={user_id}
x-business-app-key: platform-api-tester
```

需要 capability：

```text
agents.list
```

资源绑定要求：

```json
{
  "resource_bindings": {
    "agents": [
      {
        "agent_id": "2cc6e194-65ab-4096-a51a-99ccd05d662f",
        "agent_key": "codex-dev-agent",
        "scope": "user",
        "owner_user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2"
      }
    ]
  }
}
```

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_id` | 是 | 当前使用外部应用的用户 ID。只返回该用户自己的 Agent。 |
| `runtime_type` | 否 | 按运行时类型过滤，例如 `eap_native`、`hermes_agent`。 |
| `status` | 否 | 默认 `active`。 |
| `limit` | 否 | 默认 `100`，最大按平台限制裁剪。 |

示例：

```bash
curl -X GET "http://localhost:8080/api/v1/external-app/agents?user_id=$USER_ID" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester"
```

响应示例：

```json
{
  "contract": "external_app.agents.v1",
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "app_key": "platform-api-tester",
  "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
  "items": [
    {
      "id": "2cc6e194-65ab-4096-a51a-99ccd05d662f",
      "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
      "agent_key": "codex-dev-agent",
      "name": "Codex Dev Agent",
      "description": "...",
      "runtime_type": "hermes_agent",
      "scope": "user",
      "owner_user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
      "status": "active"
    }
  ],
  "count": 1,
  "trace_id": "..."
}
```

### 6.2 调用用户个人 Agent

```http
POST /api/v1/external-app/agents/{agent_id}/runs
x-business-app-key: platform-api-tester
Content-Type: application/json
```

需要 capability：

```text
agents.run
```

路径参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `agent_id` | 是 | Agent ID，必须已绑定到当前业务应用。 |

请求体：

```json
{
  "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
  "objective": "请分析这个客户的跟进风险",
  "input": {
    "customer_id": "C001"
  },
  "session_id": "optional-session-id",
  "mode": "task",
  "runtime_hint": {
    "provider": "eap_native"
  },
  "inject_context": false,
  "inject_memories": false,
  "capture_memory": false
}
```

请求字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `user_id` | 是 | 当前用户 ID。平台会校验 Agent 是否属于该用户。 |
| `objective` | 是 | 任务目标。 |
| `input` | 否 | 业务输入对象，会进入 Agent run input。 |
| `session_id` | 否 | 会话 ID。 |
| `mode` | 否 | 默认 `task`。 |
| `runtime_hint` | 否 | 运行时提示，例如 `{ "provider": "eap_native" }`。 |
| `inject_context` | 否 | 是否注入平台上下文。 |
| `inject_memories` | 否 | 是否检索并注入 Agent 记忆。 |
| `capture_memory` | 否 | 是否将结果写入记忆。 |

示例：

```bash
curl -X POST "http://localhost:8080/api/v1/external-app/agents/$AGENT_ID/runs" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
    "objective": "请分析这个客户的跟进风险",
    "input": { "customer_id": "C001" },
    "mode": "task"
  }'
```

响应示例：

```json
{
  "contract": "external_app.agent_run.v1",
  "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
  "app_key": "platform-api-tester",
  "user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
  "agent": {
    "id": "2cc6e194-65ab-4096-a51a-99ccd05d662f",
    "agent_key": "codex-dev-agent",
    "name": "Codex Dev Agent",
    "runtime_type": "hermes_agent",
    "scope": "user",
    "owner_user_id": "a3f0d748-5104-4703-a230-f5d3931a56b2",
    "status": "active"
  },
  "agent_run_id": "run-id",
  "status": "succeeded",
  "answer": "...",
  "tool_results": [],
  "usage": {
    "step_count": 3,
    "runtime_provider": "eap_native"
  },
  "run": {
    "id": "run-id",
    "status": "succeeded"
  },
  "steps": [],
  "trace_id": "..."
}
```

安全规则：

- 只允许调用 `profile.owner_user_id === user_id` 的个人 Agent。
- Agent 必须出现在当前外部应用的 `resource_bindings.agents` 或 `bindings.agents` 中。
- 不允许通过传入其他 `user_id` 调用其他用户的 Agent。
- 当前版本不开放平台 Agent。

## 7. 数据源 API

### 7.1 获取可访问数据源列表

```http
GET /api/v1/external-app/data-sources
x-business-app-key: platform-api-tester
```

需要 capability：

```text
data_sources.list
```

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `source_type` | 否 | 数据源类型，例如 `enterprise_structured_db`。 |
| `status` | 否 | 默认 `active`。 |
| `limit` | 否 | 默认 `100`。 |

响应示例：

```json
{
  "items": [
    {
      "id": "c647bb88-4e05-4306-9646-2234c918bcd1",
      "tenant_id": "8133c675-3bb4-4ace-ba10-1e83299cf761",
      "name": "示例CRM经营数据源",
      "source_type": "enterprise_structured_db",
      "adapter_id": null,
      "config": {
        "host": "crm-readonly.internal.example",
        "port": 5432,
        "database": "enterprise_crm_demo",
        "auth_secret_ref": "********"
      },
      "status": "active"
    }
  ],
  "count": 1
}
```

说明：

- 只返回当前外部应用已绑定的数据源。
- `config` 中敏感字段会脱敏。

### 7.2 获取数据源详情

```http
GET /api/v1/external-app/data-sources/{source_id}
x-business-app-key: platform-api-tester
```

需要 capability：

```text
data_sources.read
```

路径参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `source_id` | 是 | 数据源 ID。 |

示例：

```bash
curl -X GET "http://localhost:8080/api/v1/external-app/data-sources/$SOURCE_ID" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester"
```

响应体与列表项一致。

## 8. 结构化只读查询 API

### 8.1 执行结构化只读 SQL

```http
POST /api/v1/external-app/structured-query/run
x-business-app-key: platform-api-tester
Content-Type: application/json
```

需要 capability：

```text
structured.query.run
```

资源绑定要求：

- `source_id` 对应数据源必须绑定到当前外部应用。
- 数据源类型必须是 `enterprise_structured_db`。
- 当前实现支持 PostgreSQL 只读查询。

请求体：

```json
{
  "source_id": "c647bb88-4e05-4306-9646-2234c918bcd1",
  "sql": "select * from customers limit 20",
  "execution_mode": "auto",
  "max_rows": 50,
  "params": []
}
```

请求字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source_id` | 是 | 数据源 ID。也兼容 `data_source_id`。 |
| `sql` | 是 | 只允许单条 `SELECT` 或 `WITH` 查询。 |
| `execution_mode` | 否 | `auto` 或 `dry_run`，默认 `auto`。 |
| `max_rows` | 否 | 最大返回行数，受数据源策略限制。 |
| `params` | 否 | SQL 参数数组。 |

SQL 安全限制：

- 只允许 `SELECT` 或 `WITH`。
- 只允许单条 SQL。
- 禁止 `insert/update/delete/drop/alter/truncate/create/grant/revoke/copy/call/execute/do/vacuum/analyze/refresh/lock/set/reset` 等写入或管理关键字。
- 如果 SQL 没有 `limit`，平台会自动追加 `limit max_rows`。

示例：

```bash
curl -X POST "http://localhost:8080/api/v1/external-app/structured-query/run" \
  -H "Authorization: Bearer $NEXUSOS_API_KEY" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-business-app-key: platform-api-tester" \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "c647bb88-4e05-4306-9646-2234c918bcd1",
    "sql": "select * from customers limit 20",
    "execution_mode": "auto",
    "max_rows": 50
  }'
```

成功响应示例：

```json
{
  "contract": "data.query.structured_readonly.v1",
  "data_source": {
    "id": "c647bb88-4e05-4306-9646-2234c918bcd1",
    "name": "示例CRM经营数据源",
    "source_type": "enterprise_structured_db",
    "db_type": "postgresql",
    "database": "enterprise_crm_demo",
    "schema": "public"
  },
  "adapter": {
    "adapter_key": "postgresql_readonly_query_adapter",
    "status": "reserved"
  },
  "policy": {
    "max_rows": 50,
    "timeout_ms": 10000,
    "pii_masking": true
  },
  "status": "succeeded",
  "execution_mode": "executed",
  "sql": "select * from customers limit 20",
  "columns": ["id", "name"],
  "rows": [
    { "id": "C001", "name": "示例客户" }
  ],
  "row_count": 1,
  "elapsed_ms": 120
}
```

Dry-run 响应示例：

```json
{
  "contract": "data.query.structured_readonly.v1",
  "status": "planned",
  "execution_mode": "dry_run",
  "reason": "dry_run requested",
  "columns": [],
  "rows": [],
  "row_count": 0
}
```

连接失败示例：

```json
{
  "error": {
    "code": "data_source_connection_failed",
    "message": "data source connection failed: localhost:55432"
  },
  "request_id": "...",
  "trace_id": "..."
}
```

## 9. 最小接入流程

外部应用推荐按以下顺序接入：

1. 获取平台分配的 `app_key` 和 API Key。
2. 调用 `GET /api/v1/external-app/context` 确认业务应用身份、能力和资源绑定。
3. 调用 `GET /api/v1/external-app/apis` 动态获取当前可调用 API。
4. 根据需要调用：
   - 组织关系：`GET /external-app/organization-graph`
   - 用户个人 Agent：`GET /external-app/agents`、`POST /external-app/agents/{agent_id}/runs`
   - 数据源：`GET /external-app/data-sources`、`GET /external-app/data-sources/{source_id}`
   - 结构化查询：`POST /external-app/structured-query/run`
5. 使用 `request_id` 和 `trace_id` 做日志关联和问题排查。

## 10. JavaScript 调用示例

```js
const baseUrl = "http://localhost:8080/api/v1";
const apiKey = process.env.NEXUSOS_API_KEY;
const tenantId = process.env.NEXUSOS_TENANT_ID;
const appKey = "platform-api-tester";

async function platform(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "x-tenant-id": tenantId,
      "x-business-app-key": appKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }
  return body;
}

const context = await platform("/external-app/context");
console.log(context.external_app.platform_capabilities);

const agents = await platform(`/external-app/agents?user_id=${encodeURIComponent(context.user_id)}`);
console.log(agents.items);

if (agents.items[0]) {
  const run = await platform(`/external-app/agents/${agents.items[0].id}/runs`, {
    method: "POST",
    body: JSON.stringify({
      user_id: context.user_id,
      objective: "请总结今天需要跟进的事项",
      input: {},
    }),
  });
  console.log(run.answer);
}
```

## 11. PowerShell 调用示例

```powershell
$baseUrl = "http://localhost:8080/api/v1"
$headers = @{
  "Authorization" = "Bearer $env:NEXUSOS_API_KEY"
  "x-tenant-id" = $env:NEXUSOS_TENANT_ID
  "x-business-app-key" = "platform-api-tester"
  "Content-Type" = "application/json"
}

$context = Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/context" -Headers $headers
$agents = Invoke-RestMethod -Method Get -Uri "$baseUrl/external-app/agents?user_id=$($context.user_id)" -Headers $headers

$body = @{
  user_id = $context.user_id
  objective = "请总结今天需要跟进的事项"
  input = @{}
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$baseUrl/external-app/agents/$($agents.items[0].id)/runs" -Headers $headers -Body $body
```
## 12. 本地 Mock 包

平台开发阶段如果暂时没有可联调环境，外部开发人员可以使用本仓库提供的 mock server：

```text
tools/external-app-api-mock
```

启动方式：

```bash
cd tools/external-app-api-mock
npm start
```

默认 mock API Base URL：

```text
http://localhost:18080/api/v1
```

该 mock 包包含：

- `server.js`：本地 mock server，无第三方依赖。
- `README.md`：启动方式、请求示例、环境变量说明。
- `postman_collection.json`：可导入 Postman/Apifox 的接口集合。
- `.env.example`：示例租户、应用、用户、数据源和 Agent ID。

mock server 仅用于外部应用开发阶段的接口封装和前端联调；真实联调仍以平台测试环境、实际 API Key、业务应用授权和 `/api/v1/external-app/apis` manifest 为准。