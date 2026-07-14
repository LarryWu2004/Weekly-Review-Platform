import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 18080);
const tenantId = process.env.MOCK_TENANT_ID || "8133c675-3bb4-4ace-ba10-1e83299cf761";
const appKey = process.env.MOCK_APP_KEY || "platform-api-tester";
const apiKey = process.env.MOCK_API_KEY || "mock-api-key";
const userId = process.env.MOCK_USER_ID || "a3f0d748-5104-4703-a230-f5d3931a56b2";
const strictContract = ["1", "true", "yes", "on"].includes(String(process.env.MOCK_STRICT_CONTRACT || "").toLowerCase());
const rollbackUserId = process.env.MOCK_ROLLBACK_USER_ID || "";
const sourceId = process.env.MOCK_DATA_SOURCE_ID || "c647bb88-4e05-4306-9646-2234c918bcd1";
const agentId = process.env.MOCK_AGENT_ID || "2cc6e194-65ab-4096-a51a-99ccd05d662f";
const requestEvidence = [];

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
  { id: "1", tenant_id: tenantId, email: "user1@example.com", name: "展示用户 1", status: "active", metadata: { demo: true }, roles: [] },
  { id: "2", tenant_id: tenantId, email: "user2@example.com", name: "展示用户 2", status: "active", metadata: { demo: true }, roles: [] },
  { id: "3", tenant_id: tenantId, email: "user3@example.com", name: "展示用户 3", status: "active", metadata: { demo: true }, roles: [] },
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
  agent_key: "weekly-review-agent",
  name: "周报综合评阅 Agent",
  description: "综合分析工作成果、问题与下一步计划。",
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
  if (strictContract) {
    if (req.headers.authorization !== `Bearer ${apiKey}`) {
      sendError(res, 401, "invalid_api_key", "Authorization bearer token is missing or invalid", ctx);
      return false;
    }
    if (req.headers["x-tenant-id"] !== tenantId) {
      sendError(res, 403, "tenant_mismatch", "x-tenant-id does not match the mock tenant", ctx);
      return false;
    }
    if (!req.headers["x-user-id"] || !req.headers["x-request-id"]) {
      sendError(res, 400, "missing_request_context", "x-user-id and x-request-id are required in strict contract mode", ctx);
      return false;
    }
  }
  return true;
}

function organizationGraph(selectedUserId, traceId) {
  if (rollbackUserId && selectedUserId === rollbackUserId) {
    const rollbackUser = { id: rollbackUserId, tenant_id: tenantId, email: "rollback@example.com", name: "事务回滚测试用户", status: "active", metadata: { test_only: true }, roles: [] };
    const missingReviewer = { id: "missing-reviewer-for-rollback", tenant_id: tenantId, email: "missing@example.com", name: "未同步审阅人", status: "active", metadata: { test_only: true }, roles: [] };
    return {
      contract: "external_app.organization_graph.v1",
      tenant_id: tenantId,
      app_key: appKey,
      users: [rollbackUser],
      relations: [],
      superior_paths: [{
        subordinate_user_id: rollbackUser.id,
        supervisor_user_id: missingReviewer.id,
        depth: 1,
        subordinate: rollbackUser,
        supervisor: missingReviewer,
      }],
      counts: { users: 1, relations: 0, superior_paths: 1 },
      trace_id: traceId,
    };
  }
  const relationPairs = [
    { id: "rel-1", supervisor: users[1], subordinate: users[0] },
    { id: "rel-2", supervisor: users[2], subordinate: users[1] },
    { id: "rel-demo-1-2", supervisor: users[4], subordinate: users[3] },
    { id: "rel-demo-2-3", supervisor: users[5], subordinate: users[4] },
  ];
  const relations = relationPairs.map((item) => ({
    id: item.id,
    tenant_id: tenantId,
    supervisor_user_id: item.supervisor.id,
    subordinate_user_id: item.subordinate.id,
    relation_type: "direct",
    status: "active",
    metadata: {},
    supervisor: { id: item.supervisor.id, name: item.supervisor.name, email: item.supervisor.email },
    subordinate: { id: item.subordinate.id, name: item.subordinate.name, email: item.subordinate.email },
    created_at: now(),
    updated_at: now(),
  }));
  const allPaths = [
    { subordinate_user_id: users[0].id, supervisor_user_id: users[1].id, depth: 1, subordinate: users[0], supervisor: users[1] },
    { subordinate_user_id: users[0].id, supervisor_user_id: users[2].id, depth: 2, subordinate: users[0], supervisor: users[2] },
    { subordinate_user_id: users[1].id, supervisor_user_id: users[2].id, depth: 1, subordinate: users[1], supervisor: users[2] },
    { subordinate_user_id: users[3].id, supervisor_user_id: users[4].id, depth: 1, subordinate: users[3], supervisor: users[4] },
    { subordinate_user_id: users[3].id, supervisor_user_id: users[5].id, depth: 2, subordinate: users[3], supervisor: users[5] },
    { subordinate_user_id: users[4].id, supervisor_user_id: users[5].id, depth: 1, subordinate: users[4], supervisor: users[5] },
  ];
  const paths = allPaths.filter((item) => !selectedUserId || item.subordinate_user_id === selectedUserId);
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

function context(selectedUserId, traceId) {
  return {
    tenant_id: tenantId,
    user_id: selectedUserId,
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

function agentsForUser(selectedUserId) {
  if (!users.some((item) => item.id === selectedUserId)) return [];
  const baseId = selectedUserId === userId ? agentId : `mock-agent-${selectedUserId}`;
  const common = { ...agent, owner_user_id: selectedUserId };
  return [
    { ...common, id: baseId },
    {
      ...common,
      id: `${baseId}-metrics`,
      agent_key: "weekly-metrics-agent",
      name: "目标与指标 Agent",
      description: "重点检查目标、数据指标和可验证的交付结果。",
    },
    {
      ...common,
      id: `${baseId}-risk`,
      agent_key: "weekly-risk-agent",
      name: "风险识别 Agent",
      description: "重点识别阻塞、依赖、风险和需要的管理支持。",
    },
  ];
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

  if (req.method === "GET" && path === "/__test/requests") {
    return sendJson(res, 200, { items: requestEvidence, count: requestEvidence.length }, ctx);
  }

  if (!path.startsWith("/api/v1/external-app/")) {
    return sendError(res, 404, "not_found", "mock route not found", ctx);
  }
  if (!validateHeaders(req, res, ctx)) return;

  const evidence = {
    method: req.method,
    path,
    authorization_present: typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer "),
    tenant_id: String(req.headers["x-tenant-id"] || ""),
    user_id: String(req.headers["x-user-id"] || ""),
    app_key: String(req.headers["x-business-app-key"] || req.headers["x-app-key"] || ""),
    request_id: String(req.headers["x-request-id"] || ""),
    query_user_id: url.searchParams.get("user_id") || "",
    body_contract_valid: null,
  };
  requestEvidence.push(evidence);

  try {
    if (req.method === "GET" && path === "/api/v1/external-app/apis") {
      return sendJson(res, 200, { contract: "external_app.api_manifest.v1", tenant_id: tenantId, app_key: appKey, items: apiManifestItems, count: apiManifestItems.length, trace_id: ctx.traceId }, ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/context") {
      const requestedUserId = String(req.headers["x-user-id"] || userId);
      return sendJson(res, 200, context(requestedUserId, ctx.traceId), ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/organization-graph") {
      if (strictContract && evidence.query_user_id !== evidence.user_id) {
        return sendError(res, 400, "identity_mismatch", "organization graph query user_id must match x-user-id", ctx);
      }
      return sendJson(res, 200, organizationGraph(url.searchParams.get("user_id") || "", ctx.traceId), ctx);
    }
    if (req.method === "GET" && path === "/api/v1/external-app/agents") {
      const requestedUserId = url.searchParams.get("user_id") || "";
      if (!requestedUserId) return sendError(res, 400, "missing_user_id", "user_id is required", ctx);
      if (strictContract && requestedUserId !== evidence.user_id) {
        return sendError(res, 400, "identity_mismatch", "agents query user_id must match x-user-id", ctx);
      }
      const items = agentsForUser(requestedUserId);
      return sendJson(res, 200, { contract: "external_app.agents.v1", tenant_id: tenantId, app_key: appKey, user_id: requestedUserId, items, count: items.length, trace_id: ctx.traceId }, ctx);
    }
    const agentRunMatch = path.match(/^\/api\/v1\/external-app\/agents\/([^/]+)\/runs$/);
    if (req.method === "POST" && agentRunMatch) {
      const body = await readBody(req);
      const requestedAgentId = decodeURIComponent(agentRunMatch[1]);
      if (!body.user_id) return sendError(res, 400, "missing_user_id", "user_id is required", ctx);
      const selectedAgent = agentsForUser(body.user_id).find((item) => item.id === requestedAgentId);
      if (!selectedAgent) return sendError(res, 403, "resource_not_bound", "agent is not bound to this external app", ctx);
      if (!body.objective) return sendError(res, 400, "missing_objective", "objective is required", ctx);
      evidence.body_contract_valid = body.user_id === evidence.user_id
        && typeof body.objective === "string"
        && body.objective.length > 0
        && body.mode === "task"
        && body.runtime_hint?.provider === "eap_native"
        && body.inject_context === false
        && body.inject_memories === false
        && body.capture_memory === false
        && typeof body.input?.current_report?.title === "string"
        && typeof body.input?.current_report?.current_work === "string"
        && typeof body.input?.current_report?.next_plan === "string"
        && Array.isArray(body.input?.current_report?.attachments)
        && Array.isArray(body.input?.history_reports)
        && Array.isArray(body.input?.comments);
      if (strictContract && !evidence.body_contract_valid) {
        return sendError(res, 400, "invalid_agent_run_contract", "Agent run request does not match the documented contract", ctx);
      }
      const runId = randomUUID();
      const weeklySectionsReceived = typeof body.input?.current_report?.current_work === "string"
        && typeof body.input?.current_report?.next_plan === "string";
      const answer = `${selectedAgent.name} 已完成任务：${body.objective}${weeklySectionsReceived ? "；已接收分栏的本周工作与下周计划" : ""}`;
      return sendJson(res, 201, {
        contract: "external_app.agent_run.v1",
        tenant_id: tenantId,
        app_key: appKey,
        user_id: body.user_id,
        agent: selectedAgent,
        agent_run_id: runId,
        status: "succeeded",
        answer,
        tool_results: [],
        usage: { step_count: 2, runtime_provider: body.runtime_hint?.provider || "eap_native" },
        run: { id: runId, status: "succeeded", objective: body.objective, output: { answer } },
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
