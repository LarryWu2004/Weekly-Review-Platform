import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 18080);
const tenantId = process.env.MOCK_TENANT_ID || "8133c675-3bb4-4ace-ba10-1e83299cf761";
const appKey = process.env.MOCK_APP_KEY || "platform-api-tester";
const userId = process.env.MOCK_USER_ID || "a3f0d748-5104-4703-a230-f5d3931a56b2";
const sourceId = process.env.MOCK_DATA_SOURCE_ID || "c647bb88-4e05-4306-9646-2234c918bcd1";
const agentId = process.env.MOCK_AGENT_ID || "2cc6e194-65ab-4096-a51a-99ccd05d662f";

const now = () => new Date().toISOString();

const capabilities = [
  "resource.context.read",
  "organization.graph.read",
  "agents.list",
  "agents.run",
  "data_sources.list",
  "data_sources.read",
  "structured.query.run",
];

const users = [
  { id: userId, tenant_id: tenantId, email: "alice@example.com", name: "Alice", status: "active", metadata: {}, roles: [] },
  { id: "f7f12c63-49c0-4ed4-a032-216ea27ad9d2", tenant_id: tenantId, email: "manager@example.com", name: "Manager", status: "active", metadata: {}, roles: [] },
  { id: "47d2767a-a540-43e2-a9f3-31c4835687d9", tenant_id: tenantId, email: "director@example.com", name: "Director", status: "active", metadata: {}, roles: [] },
];

const dataSource = {
  id: sourceId,
  tenant_id: tenantId,
  name: "示例CRM经营数据源",
  source_type: "enterprise_structured_db",
  adapter_id: null,
  config: {
    host: "crm-readonly.internal.example",
    port: 5432,
    database: "enterprise_crm_demo",
    schema: "public",
    db_type: "postgresql",
    readonly: true,
    auth_secret_ref: "********",
  },
  status: "active",
  created_at: now(),
  updated_at: now(),
};

const agent = {
  id: agentId,
  tenant_id: tenantId,
  agent_key: "codex-dev-agent",
  name: "Codex Dev Agent",
  description: "用于开发任务协作的个人 Agent。",
  runtime_type: "eap_native",
  scope: "user",
  owner_user_id: userId,
  status: "active",
  created_at: now(),
  updated_at: now(),
};

const apiManifestItems = [
  {
    key: "api_manifest",
    name: "API 清单",
    method: "GET",
    path: "/api/v1/external-app/apis",
    capability: "resource.context.read",
    description: "列出当前业务应用已授权、可调用的 External App API。",
    params: [{ key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true }],
  },
  {
    key: "context",
    name: "运行上下文",
    method: "GET",
    path: "/api/v1/external-app/context",
    capability: "resource.context.read",
    description: "读取当前租户、用户、业务应用绑定和能力声明。",
    params: [{ key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true }],
  },
  {
    key: "organization_graph",
    name: "组织关系图",
    method: "GET",
    path: "/api/v1/external-app/organization-graph",
    capability: "organization.graph.read",
    description: "读取当前租户用户、有向上下级关系和传递上级闭包。",
    params: [
      { key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true },
      { key: "user_id", label: "用户", type: "user", in: "query", required: false },
    ],
  },
  {
    key: "agents",
    name: "Agent 列表",
    method: "GET",
    path: "/api/v1/external-app/agents",
    capability: "agents.list",
    description: "列出当前业务应用已绑定、且属于指定用户的个人 Agent。",
    params: [
      { key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true },
      { key: "user_id", label: "用户", type: "user", in: "query", required: true },
    ],
  },
  {
    key: "agent_run",
    name: "调用 Agent",
    method: "POST",
    path: "/api/v1/external-app/agents/:agent_id/runs",
    capability: "agents.run",
    description: "调用当前业务应用已绑定、且属于指定用户的个人 Agent。",
    params: [
      { key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true },
      { key: "agent_id", label: "Agent", type: "agent", in: "path", required: true },
      { key: "user_id", label: "用户", type: "user", in: "body", required: true },
      { key: "objective", label: "任务目标", type: "textarea", in: "body", required: true, default: "请完成这个任务并返回结果" },
    ],
  },
  {
    key: "data_sources",
    name: "数据源列表",
    method: "GET",
    path: "/api/v1/external-app/data-sources",
    capability: "data_sources.list",
    description: "列出当前外部应用已绑定的数据源。",
    params: [{ key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true }],
  },
  {
    key: "data_source_detail",
    name: "数据源详情",
    method: "GET",
    path: "/api/v1/external-app/data-sources/:source_id",
    capability: "data_sources.read",
    description: "读取单个绑定数据源详情，敏感配置会脱敏。",
    params: [
      { key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true },
      { key: "source_id", label: "数据源", type: "data_source", in: "path", required: true },
    ],
  },
  {
    key: "structured_query",
    name: "结构化只读查询",
    method: "POST",
    path: "/api/v1/external-app/structured-query/run",
    capability: "structured.query.run",
    description: "对已绑定企业结构化数据源执行受控只读 SQL。",
    params: [
      { key: "app_key", label: "业务应用 Key", type: "app_key", in: "header", header: "x-business-app-key", required: true },
      { key: "source_id", label: "数据源", type: "data_source", in: "body", required: true },
      { key: "sql", label: "SQL", type: "textarea", in: "body", required: true, default: "select * from customers limit 20" },
      { key: "execution_mode", label: "执行模式", type: "select", in: "body", options: ["auto", "dry_run"], required: false, default: "auto" },
      { key: "max_rows", label: "最大行数", type: "number", in: "body", required: false, default: 50 },
    ],
  },
];

function makeContext(req) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  const traceId = req.headers["x-trace-id"] || randomUUID();
  return { requestId, traceId };
}

function sendJson(res, status, body, ctx) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization,x-request-id,x-trace-id,x-tenant-id,x-user-id,x-user-email,x-business-app-key,x-app-key,x-external-app-key",
    "x-request-id": ctx.requestId,
    "x-trace-id": ctx.traceId,
    "x-tenant-id": tenantId,
    "x-user-id": userId,
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, status, code, message, ctx) {
  sendJson(res, status, { error: { code, message }, request_id: ctx.requestId, trace_id: ctx.traceId }, ctx);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("invalid JSON body");
    error.status = 400;
    error.code = "bad_request";
    throw error;
  }
}

function validateHeaders(req, res, ctx) {
  const receivedAppKey = req.headers["x-business-app-key"] || req.headers["x-app-key"] || "";
  if (!receivedAppKey) {
    sendError(res, 400, "missing_app_key", "app_key or x-business-app-key is required", ctx);
    return false;
  }
  if (receivedAppKey !== appKey) {
    sendError(res, 404, "app_not_found", "business app not found", ctx);
    return false;
  }
  return true;
}

function organizationGraph(selectedUserId, traceId) {
  const relations = [
    {
      id: "rel-1",
      tenant_id: tenantId,
      supervisor_user_id: users[1].id,
      subordinate_user_id: users[0].id,
      relation_type: "direct",
      status: "active",
      metadata: {},
      supervisor: { id: users[1].id, name: users[1].name, email: users[1].email },
      subordinate: { id: users[0].id, name: users[0].name, email: users[0].email },
      created_at: now(),
      updated_at: now(),
    },
    {
      id: "rel-2",
      tenant_id: tenantId,
      supervisor_user_id: users[2].id,
      subordinate_user_id: users[1].id,
      relation_type: "direct",
      status: "active",
      metadata: {},
      supervisor: { id: users[2].id, name: users[2].name, email: users[2].email },
      subordinate: { id: users[1].id, name: users[1].name, email: users[1].email },
      created_at: now(),
      updated_at: now(),
    },
  ];
  const paths = [
    { subordinate_user_id: users[0].id, supervisor_user_id: users[1].id, depth: 1, subordinate: users[0], supervisor: users[1] },
    { subordinate_user_id: users[0].id, supervisor_user_id: users[2].id, depth: 2, subordinate: users[0], supervisor: users[2] },
    { subordinate_user_id: users[1].id, supervisor_user_id: users[2].id, depth: 1, subordinate: users[1], supervisor: users[2] },
  ].filter((item) => !selectedUserId || item.subordinate_user_id === selectedUserId);
  return {
    contract: "external_app.organization_graph.v1",
    tenant_id: tenantId,
    app_key: appKey,
    users,
    relations,
    superior_paths: paths,
    counts: { users: users.length, relations: relations.length, superior_paths: paths.length },
    trace_id: traceId,
  };
}

function context(traceId) {
  return {
    tenant_id: tenantId,
    user_id: userId,
    app: { app_key: appKey, name: "平台 API 测试台", status: "active", runtime_provider: "external_app" },
    external_app: {
      adapter_key: "external_app.api_tester.v1",
      launch_mode: "api_tester",
      entry_url: null,
      api_base_url: null,
      platform_capabilities: capabilities,
    },
    resources: {
      data_sources: [{ source_id: dataSource.id, id: dataSource.id, name: dataSource.name, source_type: dataSource.source_type }],
    },
    trace_id: traceId,
  };
}

function structuredQuery(body) {
  const executionMode = body.execution_mode || "auto";
  if (!body.source_id && !body.data_source_id) {
    return { status: 400, body: { error: { code: "bad_request", message: "source_id is required" } } };
  }
  if (!body.sql) {
    return { status: 400, body: { error: { code: "bad_request", message: "sql is required" } } };
  }
  if (body.source_id !== dataSource.id && body.data_source_id !== dataSource.id) {
    return { status: 403, body: { error: { code: "resource_not_bound", message: "data source is not bound to this external app" } } };
  }
  if (executionMode === "dry_run") {
    return {
      status: 200,
      body: {
        contract: "data.query.structured_readonly.v1",
        data_source: { id: dataSource.id, name: dataSource.name, source_type: dataSource.source_type, db_type: "postgresql", database: "enterprise_crm_demo", schema: "public" },
        adapter: { adapter_key: "postgresql_readonly_query_adapter", status: "reserved" },
        policy: { max_rows: Number(body.max_rows || 50), timeout_ms: 10000, pii_masking: true },
        sql: body.sql,
        status: "planned",
        execution_mode: "dry_run",
        reason: "dry_run requested",
        columns: [],
        rows: [],
        row_count: 0,
      },
    };
  }
  return {
    status: 200,
    body: {
      contract: "data.query.structured_readonly.v1",
      data_source: { id: dataSource.id, name: dataSource.name, source_type: dataSource.source_type, db_type: "postgresql", database: "enterprise_crm_demo", schema: "public" },
      adapter: { adapter_key: "postgresql_readonly_query_adapter", status: "reserved" },
      policy: { max_rows: Number(body.max_rows || 50), timeout_ms: 10000, pii_masking: true },
      sql: body.sql,
      status: "succeeded",
      execution_mode: "executed",
      columns: ["customer_id", "customer_name", "risk_score"],
      rows: [
        { customer_id: "C001", customer_name: "华东能源集团", risk_score: 82 },
        { customer_id: "C002", customer_name: "星河零售", risk_score: 64 },
      ],
      row_count: 2,
      elapsed_ms: 32,
    },
  };
}

async function handle(req, res) {
  const ctx = makeContext(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, ctx);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (path === "/" || path === "/health" || path === "/api/v1/health") {
    return sendJson(res, 200, { status: "ok", service: "external-app-api-mock", base_url: `http://localhost:${port}/api/v1` }, ctx);
  }

  if (!path.startsWith("/api/v1/external-app/")) {
    return sendError(res, 404, "not_found", "mock route not found", ctx);
  }
  if (!validateHeaders(req, res, ctx)) return;

  try {
    if (req.method === "GET" && path === "/api/v1/external-app/apis") {
      return sendJson(res, 200, { contract: "external_app.api_manifest.v1", tenant_id: tenantId, app_key: appKey, items: apiManifestItems, count: apiManifestItems.length, trace_id: ctx.traceId }, ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/context") {
      return sendJson(res, 200, context(ctx.traceId), ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/organization-graph") {
      return sendJson(res, 200, organizationGraph(url.searchParams.get("user_id") || "", ctx.traceId), ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/agents") {
      const requestedUserId = url.searchParams.get("user_id") || "";
      if (!requestedUserId) return sendError(res, 400, "missing_user_id", "user_id is required", ctx);
      const items = requestedUserId === userId ? [agent] : [];
      return sendJson(res, 200, { contract: "external_app.agents.v1", tenant_id: tenantId, app_key: appKey, user_id: requestedUserId, items, count: items.length, trace_id: ctx.traceId }, ctx);
    }
    const agentRunMatch = path.match(/^\/api\/v1\/external-app\/agents\/([^/]+)\/runs$/);
    if (req.method === "POST" && agentRunMatch) {
      const body = await readBody(req);
      const requestedAgentId = decodeURIComponent(agentRunMatch[1]);
      if (requestedAgentId !== agent.id) return sendError(res, 403, "resource_not_bound", "agent is not bound to this external app", ctx);
      if (!body.user_id) return sendError(res, 400, "missing_user_id", "user_id is required", ctx);
      if (body.user_id !== userId) return sendError(res, 403, "agent_not_accessible", "agent does not belong to this user", ctx);
      if (!body.objective) return sendError(res, 400, "missing_objective", "objective is required", ctx);
      const runId = randomUUID();
      return sendJson(res, 201, {
        contract: "external_app.agent_run.v1",
        tenant_id: tenantId,
        app_key: appKey,
        user_id: body.user_id,
        agent,
        agent_run_id: runId,
        status: "succeeded",
        answer: `Mock Agent 已完成任务：${body.objective}`,
        tool_results: [],
        usage: { step_count: 2, runtime_provider: body.runtime_hint?.provider || "eap_native" },
        run: { id: runId, status: "succeeded", objective: body.objective, output: { answer: `Mock Agent 已完成任务：${body.objective}` } },
        steps: [
          { step_index: 1, step_type: "mock_plan", content: "解析任务目标" },
          { step_index: 2, step_type: "mock_answer", content: "返回模拟执行结果" },
        ],
        trace_id: ctx.traceId,
      }, ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/data-sources") {
      return sendJson(res, 200, { items: [dataSource], count: 1 }, ctx);
    }
    const sourceMatch = path.match(/^\/api\/v1\/external-app\/data-sources\/([^/]+)$/);
    if (req.method === "GET" && sourceMatch) {
      const requestedSourceId = decodeURIComponent(sourceMatch[1]);
      if (requestedSourceId !== dataSource.id) return sendError(res, 403, "resource_not_bound", "data source is not bound to this external app", ctx);
      return sendJson(res, 200, dataSource, ctx);
    }
    if (req.method === "POST" && path === "/api/v1/external-app/structured-query/run") {
      const body = await readBody(req);
      const result = structuredQuery(body);
      if (result.body.error) return sendJson(res, result.status, { ...result.body, request_id: ctx.requestId, trace_id: ctx.traceId }, ctx);
      return sendJson(res, result.status, result.body, ctx);
    }
    return sendError(res, 404, "not_found", "mock route not found", ctx);
  } catch (error) {
    return sendError(res, error.status || 500, error.code || "internal_error", error.message || "Internal server error", ctx);
  }
}

http.createServer(handle).listen(port, () => {
  console.log(`NexusOS External App API mock server listening on http://localhost:${port}`);
  console.log(`App key: ${appKey}`);
  console.log(`User ID: ${userId}`);
  console.log(`Data source ID: ${sourceId}`);
  console.log(`Agent ID: ${agentId}`);
});