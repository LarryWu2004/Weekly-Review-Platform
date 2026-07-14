import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "./api";
import { Empty } from "./ui";

type AgentProfile = {
  id: string;
  agent_key?: string;
  name: string;
  description?: string;
  runtime_type: string;
  scope?: string;
  owner_user_id: string;
  status?: string;
};

type AgentSettingsResponse = {
  items: AgentProfile[];
  count: number;
  selected_agent_id: string | null;
  configured: boolean;
  updated_at: string | null;
};

export function AgentSettings({ notify }: { notify: (message: string) => void }) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<AgentSettingsResponse>("/api/agent-settings");
      setAgents(result.items);
      setSelectedId(result.selected_agent_id);
      setSavedId(result.configured ? result.selected_agent_id : null);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Agent 列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const selectedAgent = useMemo(() => agents.find((item) => item.id === selectedId) || null, [agents, selectedId]);

  async function save() {
    if (!selectedId || selectedId === savedId) return;
    setSaving(true);
    try {
      const result = await api<{ selected_agent_id: string }>("/api/agent-settings", {
        method: "PUT",
        body: JSON.stringify({ agent_id: selectedId }),
      });
      setSavedId(result.selected_agent_id);
      notify("Agent 配置已保存，后续周报分析将使用该 Agent");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Agent 配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <div className="page-content agent-settings-page">
    <section className="page-heading agent-settings-heading">
      <div><span className="eyebrow">个人分析能力</span><h1>Agent 配置</h1></div>
      <p>从平台返回的个人 Agent 中选择一个，后续由你发起的周报分析将使用该 Agent。</p>
      <button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""} size={16} />刷新列表</button>
    </section>

    <section className="agent-current" aria-live="polite">
      <span className="agent-current-icon"><Bot size={23} /></span>
      <span><small>当前选择</small><strong>{selectedAgent?.name || "尚未选择 Agent"}</strong><p>{selectedAgent?.description || "平台返回可用 Agent 后即可进行选择。"}</p></span>
      {savedId && selectedId === savedId ? <span className="agent-saved-state"><ShieldCheck size={16} />已生效</span> : selectedId ? <span className="agent-pending-state">待保存</span> : null}
    </section>

    <section>
      <div className="section-toolbar agent-list-toolbar"><h2>平台可调用 Agent</h2><span>{agents.length} 个可用</span></div>
      {loading ? <div className="agent-settings-loading"><LoaderCircle className="spin" size={22} /><span>正在读取平台 Agent 列表</span></div>
        : agents.length ? <div className="agent-option-list">{agents.map((agent, index) => {
          const selected = agent.id === selectedId;
          const active = agent.id === savedId;
          return <button key={agent.id} className={`agent-option ${selected ? "is-selected" : ""}`} onClick={() => setSelectedId(agent.id)} aria-pressed={selected}>
            <span className="agent-option-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="agent-option-mark">{selected ? <Check size={16} /> : null}</span>
            <span className="agent-option-copy"><strong>{agent.name}</strong><p>{agent.description || "平台未提供 Agent 说明。"}</p><span><em>{agent.runtime_type}</em>{agent.agent_key ? <em>{agent.agent_key}</em> : null}</span></span>
            <span className="agent-option-status">{active ? "当前使用" : selected ? "已选择" : "选择"}</span>
          </button>;
        })}</div>
          : <Empty icon={<Bot size={28} />} title="当前没有可调用的 Agent" body="请在平台为当前用户绑定个人 Agent，并确认应用已获得 agents.list 和 agents.run 能力。" />}
    </section>

    {agents.length ? <div className="agent-settings-actions"><p>{selectedId === savedId ? "当前配置已保存。" : "选择尚未生效，请保存配置。"}</p><button className="primary-button" disabled={!selectedId || selectedId === savedId || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "正在保存" : "保存配置"}</button></div> : null}
  </div>;
}
