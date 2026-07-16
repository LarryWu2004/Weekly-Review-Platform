import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Bell, BookOpen, CheckCheck, FilePlus2, LoaderCircle, MessageSquare, Plus, Settings2, Users } from "lucide-react";
import { api, ApiError } from "./api";
import { AgentSettings } from "./AgentSettings";
import { AllReportsArchive } from "./AllReportsArchive";
import { CreateReportModal } from "./CreateReportModal";
import { ReportDrawer } from "./ReportDrawer";
import type { Message, Report, ReportDetail, Session } from "./types";
import { Avatar, Empty, formatDate, formatWeek, Metric, weekNumber } from "./ui";

type View = "mine" | "review" | "messages" | "agents";
type ReportPage = { items: Report[]; count: number; next_offset: number | null };
type MessagePage = { items: Message[]; count: number; unread_count: number; next_offset: number | null };
const PAGE_SIZE = 20;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportCount, setReportCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<View>("mine");
  const [showAllReports, setShowAllReports] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [toast, setToast] = useState("");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadReports = useCallback(async (activeScope: "mine" | "review" = view === "review" ? "review" : "mine") => {
    const result = await api<ReportPage>(`/api/reports?scope=${activeScope}&limit=${PAGE_SIZE}&offset=0`);
    setReports(result.items);
    setReportCount(result.count);
  }, [view]);

  const loadMessages = useCallback(async () => {
    const result = await api<MessagePage>(`/api/messages?limit=${PAGE_SIZE}&offset=0`);
    setMessages(result.items);
    setMessageCount(result.count);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setErrorStatus(0);
    const contentRequest = view === "messages"
      ? api<MessagePage>(`/api/messages?limit=${PAGE_SIZE}&offset=0`)
      : view === "agents"
        ? Promise.resolve(null)
        : api<ReportPage>(`/api/reports?scope=${view}&limit=${PAGE_SIZE}&offset=0`);
    Promise.all([api<Session>("/api/session"), contentRequest])
      .then(([nextSession, result]) => {
        if (cancelled) return;
        setSession(nextSession);
        if (view === "messages") {
          const page = result as MessagePage;
          setMessages(page.items);
          setMessageCount(page.count);
        } else if (view !== "agents") {
          const page = result as ReportPage;
          setReports(page.items);
          setReportCount(page.count);
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "应用加载失败");
        setErrorStatus(caught instanceof ApiError ? caught.status : 0);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

  function switchView(next: View) {
    setSelectedId(null);
    setSelectedCommentId(null);
    setShowAllReports(false);
    setView(next);
  }

  async function refresh() {
    if (view === "messages") await loadMessages();
    else if (view !== "agents") await loadReports();
    const nextSession = await api<Session>("/api/session");
    setSession(nextSession);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      if (view === "messages") {
        const result = await api<MessagePage>(`/api/messages?limit=${PAGE_SIZE}&offset=${messages.length}`);
        setMessages((current) => [...current, ...result.items]);
        setMessageCount(result.count);
      } else {
        const result = await api<ReportPage>(`/api/reports?scope=${view}&limit=${PAGE_SIZE}&offset=${reports.length}`);
        setReports((current) => [...current, ...result.items]);
        setReportCount(result.count);
      }
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }

  function openMessage(message: Message) {
    setSelectedCommentId(message.id);
    setSelectedId(message.report_id);
    if (message.read_at) return;
    const optimisticReadAt = new Date().toISOString();
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, read_at: optimisticReadAt } : item));
    setSession((current) => current ? {
      ...current,
      stats: { ...current.stats, unread_messages: Math.max(0, current.stats.unread_messages - 1) },
    } : current);
    void api<{ id: string; read_at: string }>(`/api/messages/${message.id}/read`, { method: "POST" })
      .then((result) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, read_at: result.read_at } : item)))
      .catch(async (caught) => {
        notify(caught instanceof Error ? caught.message : "标记消息已读失败");
        await Promise.all([loadMessages(), api<Session>("/api/session").then(setSession)]);
      });
  }

  async function markAllRead() {
    if (!session?.stats.unread_messages) return;
    setMarkingAllRead(true);
    try {
      const result = await api<{ updated: number; read_at: string }>("/api/messages/read-all", { method: "POST" });
      setMessages((current) => current.map((item) => ({ ...item, read_at: item.read_at || result.read_at })));
      setSession((current) => current ? { ...current, stats: { ...current.stats, unread_messages: 0 } } : current);
      notify(result.updated ? `已将 ${result.updated} 条消息设为已读` : "没有未读消息");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "全部已读失败");
    } finally {
      setMarkingAllRead(false);
    }
  }

  if (loading && !session) return <div className="loading-screen"><div className="loading-mark"><strong>周</strong><span>正在连接组织与周报服务</span></div></div>;
  if (error || !session) return <div className="error-banner"><div><h2>{errorStatus === 401 ? "请从平台打开应用" : "暂时无法打开应用"}</h2><p>{error || "未获取到用户上下文"}</p></div><button className="primary-button" onClick={() => location.reload()}>{errorStatus === 401 ? "重新检查会话" : "重新加载"}</button></div>;

  const stats = session.stats;
  const pendingReviewReports = reports.filter((report) => report.reviewer_comment_count === 0);
  const reviewedReports = reports.filter((report) => report.reviewer_comment_count > 0);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="周报协作"><div className="brand-mark"><BookOpen size={20} strokeWidth={2.2} /></div><div><strong>周报协作</strong></div></div>
        <div className="sidebar-main">
          <nav className="sidebar-nav" aria-label="主要导航">
            <button className={`nav-item ${view === "mine" ? "active" : ""}`} onClick={() => switchView("mine")}>
              <span className="nav-index">01</span><FilePlus2 className="nav-icon" size={19} />
              <span className="nav-copy"><strong>我的周报</strong><small>提交与回顾个人进展</small></span><span className="nav-count">{stats.mine}</span>
            </button>
            <button className={`nav-item ${view === "review" ? "active" : ""}`} onClick={() => switchView("review")}>
              <span className="nav-index">02</span><Users className="nav-icon" size={19} />
              <span className="nav-copy"><strong>审阅周报</strong><small>查看并反馈团队周报</small></span><span className="nav-count">{stats.review}</span>
            </button>
            <button className={`nav-item ${view === "messages" ? "active" : ""}`} onClick={() => switchView("messages")}>
              <span className="nav-index">03</span><Bell className="nav-icon" size={19} />
              <span className="nav-copy"><strong>我的消息</strong><small>查看收到的周报评论</small></span>
              {stats.unread_messages > 0 ? <span className="nav-unread-dot" aria-label={`${stats.unread_messages} 条未读消息`} /> : null}
            </button>
            <button className={`nav-item ${view === "agents" ? "active" : ""}`} onClick={() => switchView("agents")}>
              <span className="nav-index">04</span><Settings2 className="nav-icon" size={19} />
              <span className="nav-copy"><strong>Agent 配置</strong><small>选择周报分析 Agent</small></span>
            </button>
          </nav>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="platform-identity">
            <div className="user-switch is-static"><Avatar name={session.current_user.name} /><span><strong>{session.current_user.name}</strong><small>{session.current_user.email}</small></span></div>
          </div>
        </header>

        {view === "agents" ? <AgentSettings notify={notify} /> : showAllReports && (view === "mine" || view === "review") ? <AllReportsArchive
          scope={view}
          onClose={() => setShowAllReports(false)}
          notify={notify}
          renderReport={(report) => <ReportRow key={report.id} report={report} onOpen={() => { setSelectedCommentId(null); setSelectedId(report.id); }} />}
        /> : <div className="page-content">
          <section className="page-heading">
            <div><span className="eyebrow">{view === "mine" ? "个人进展" : view === "review" ? "团队反馈" : "评论通知"}</span><h1>{view === "mine" ? "我的周报" : view === "review" ? "审阅周报" : "我的消息"}</h1></div>
            <p>{view === "mine" ? "记录每周成果、风险与下一步行动，让进展清楚地被看见。" : view === "review" ? "查看组织权限内可审阅的周报，留下具体、可执行的反馈。" : "集中查看收到的周报评论，点击消息可直接定位到对应反馈。"}</p>
            {view === "mine" ? <button className="primary-button" onClick={() => setCreating(true)}><Plus size={17} />提交周报</button> : null}
            {view === "messages" ? <button className="secondary-button mark-all-button" disabled={!stats.unread_messages || markingAllRead} onClick={() => void markAllRead()}>{markingAllRead ? <LoaderCircle className="spin" size={16} /> : <CheckCheck size={16} />}{markingAllRead ? "正在处理" : "全部已读"}</button> : null}
          </section>

          {view !== "messages" ? <>
            <section className="metric-grid" aria-label="周报概览">
              <Metric index="01" value={stats.mine} label="累计提交" />
              <Metric index="02" value={stats.review} label="可审阅周报" />
              <Metric index="03" value={stats.comments} label="已发表反馈" />
            </section>

            <section className={view === "review" ? "review-queue" : undefined}>
              <div className="section-toolbar"><h2>{view === "mine" ? "提交记录" : "审阅队列"}</h2><div className="section-toolbar-actions"><span>{reportCount} 份周报</span><button className="view-all-reports" onClick={() => setShowAllReports(true)}>搜索/筛选周报</button></div></div>
              {view === "mine"
                ? reports.length
                  ? <div className="report-list">{reports.map((report) => <ReportRow key={report.id} report={report} onOpen={() => { setSelectedCommentId(null); setSelectedId(report.id); }} />)}</div>
                  : <Empty icon={<FilePlus2 size={28} />} title="还没有提交记录" body="提交第一份周报后，具备审阅权限的相关成员可以查看。" />
                : <div className="review-groups">
                    <ReviewGroup
                      title="待审阅"
                      description="尚未留下反馈的周报"
                      reports={pendingReviewReports}
                      emptyText="当前没有待审阅周报"
                      onOpen={(reportId) => { setSelectedCommentId(null); setSelectedId(reportId); }}
                    />
                    <ReviewGroup
                      title="已审阅"
                      description="你已经发表过评论的周报"
                      reports={reviewedReports}
                      emptyText="还没有已审阅周报"
                      reviewed
                      onOpen={(reportId) => { setSelectedCommentId(null); setSelectedId(reportId); }}
                    />
                  </div>}
              {reports.length < reportCount ? <div className="load-more"><button className="secondary-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="spin" size={16} /> : null}{loadingMore ? "正在加载" : "加载更多"}</button></div> : null}
            </section>
          </> : <section className="messages-section">
            <div className="section-toolbar message-toolbar"><h2>评论通知</h2><span>{stats.unread_messages} 条未读 · 共 {messageCount} 条</span></div>
            {messages.length ? <div className="message-list">{messages.map((message, index) => <MessageRow key={message.id} message={message} index={index + 1} onOpen={() => openMessage(message)} />)}</div>
              : <Empty icon={<Bell size={28} />} title="暂时没有评论消息" body="周报收到评论后，消息会按时间显示在这里。" />}
            {messages.length < messageCount ? <div className="load-more"><button className="secondary-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="spin" size={16} /> : null}{loadingMore ? "正在加载" : "加载更多"}</button></div> : null}
          </section>}
        </div>}
      </main>

      {creating ? <CreateReportModal onClose={() => setCreating(false)} onCreated={(report: ReportDetail) => { setCreating(false); setSelectedId(report.id); void refresh(); notify("周报已提交并同步可见权限"); }} /> : null}
      {selectedId ? <ReportDrawer reportId={selectedId} currentUserId={session.current_user.id} focusCommentId={selectedCommentId} onClose={() => { setSelectedId(null); setSelectedCommentId(null); }} onChanged={() => void refresh()} onDeleted={() => { setSelectedId(null); setSelectedCommentId(null); void refresh(); }} notify={notify} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function MessageRow({ message, index, onOpen }: { message: Message; index: number; onOpen: () => void }) {
  const unread = !message.read_at;
  return <button className={`message-row ${unread ? "is-unread" : ""}`} onClick={onOpen}>
    <span className="message-folio">{String(index).padStart(2, "0")}</span>
    <span className="message-state" aria-hidden="true">{unread ? <span /> : <CheckCheck size={15} />}</span>
    <span className="message-copy">
      <span className="message-report"><strong>{message.report_title}</strong><small>{formatWeek(message.report_week_start)}</small></span>
      <span className="message-comment">{message.content}</span>
      <span className="message-sender"><Avatar name={message.commenter_name} /><strong>{message.commenter_name}</strong><time>{formatDate(message.created_at)}</time></span>
    </span>
    <ArrowRight className="message-arrow" size={19} />
  </button>;
}

function ReportRow({ report, onOpen }: { report: Report; onOpen: () => void }) {
  return <button className="report-row" onClick={onOpen}>
    <span className="week-folio"><span>WEEK</span><strong>{weekNumber(report.week_start)}</strong></span>
    <span className="report-copy"><h3>{report.title}</h3><p>{report.attachment_count} 个周报附件</p><span className="report-author"><Avatar name={report.author_name} />{report.author_name}</span></span>
    <span className="report-meta"><span>{formatWeek(report.week_start)}</span><span><MessageSquare size={14} />{report.comment_count} 条评论</span><span>提交于 {formatDate(report.created_at)}</span></span>
    <ArrowRight className="row-arrow" size={20} />
  </button>;
}

function ReviewGroup({ title, description, reports, emptyText, reviewed = false, onOpen }: {
  title: string;
  description: string;
  reports: Report[];
  emptyText: string;
  reviewed?: boolean;
  onOpen: (reportId: string) => void;
}) {
  return <section className={`review-group ${reviewed ? "is-reviewed" : "is-pending"}`}>
    <header className="review-group-heading">
      <span className="review-group-state" aria-hidden="true">{reviewed ? <CheckCheck size={17} /> : <MessageSquare size={17} />}</span>
      <span><strong>{title}</strong><small>{description}</small></span>
      <span className="review-group-count">{reports.length}</span>
    </header>
    {reports.length
      ? <div className="report-list">{reports.map((report) => <ReportRow key={report.id} report={report} onOpen={() => onOpen(report.id)} />)}</div>
      : <div className="review-group-empty"><span>{emptyText}</span></div>}
  </section>;
}
