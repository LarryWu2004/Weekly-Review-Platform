import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export class PlatformError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, userId: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.platformBaseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(config.platformTimeoutMs),
      headers: {
        Authorization: `Bearer ${config.platformApiKey}`,
        "x-tenant-id": config.tenantId,
        "x-user-id": userId,
        "x-business-app-key": config.appKey,
        "x-request-id": randomUUID(),
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new PlatformError(timedOut ? "平台请求超时" : "平台连接失败", 502, timedOut ? "platform_timeout" : "platform_unavailable");
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new PlatformError(
      body.error?.message || `平台请求失败（HTTP ${response.status}）`,
      response.status,
      body.error?.code || "platform_error",
    );
  }
  return body as T;
}

export type OrganizationGraph = {
  users: Array<{ id: string; name: string; email: string }>;
  superior_paths: Array<{
    subordinate_user_id: string;
    supervisor_user_id: string;
    depth: number;
    supervisor: { id: string; name: string; email: string };
  }>;
  trace_id?: string;
};

export type AgentProfile = {
  id: string;
  name: string;
  description?: string;
  agent_key?: string;
  runtime_type: string;
  scope?: string;
  owner_user_id: string;
  status?: string;
};

export const platform = {
  context(userId: string) {
    return request<Record<string, unknown>>("/external-app/context", userId);
  },
  organizationGraph(userId: string) {
    return request<OrganizationGraph>(
      `/external-app/organization-graph?user_id=${encodeURIComponent(userId)}`,
      userId,
    );
  },
  agents(userId: string) {
    return request<{ items: AgentProfile[] }>(
      `/external-app/agents?user_id=${encodeURIComponent(userId)}`,
      userId,
    );
  },
  runAgent(agentId: string, userId: string, input: unknown) {
    return request<{
      agent_run_id: string;
      status: string;
      answer: string;
      trace_id?: string;
    }>(`/external-app/agents/${encodeURIComponent(agentId)}/runs`, userId, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        objective: "请评价本次周报内容，结合历史周报和已有评论指出不足，并给出具体、可执行的改进建议",
        input,
        mode: "task",
        runtime_hint: { provider: "eap_native" },
        inject_context: false,
        inject_memories: false,
        capture_memory: false,
      }),
    });
  },
};
