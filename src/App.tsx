import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BookOpen, Bot, ChevronDown, FilePlus2, LoaderCircle, MessageSquare, Plus, Users } from "lucide-react";
import { api } from "./api";
import { CreateReportModal } from "./CreateReportModal";
import { ReportDrawer } from "./ReportDrawer";
import type { Report, ReportDetail, Session, User } from "./types";
import { Avatar, Empty, formatDate, formatWeek, Metric, weekNumber } from "./ui";

const DEFAULT_USER = "a3f0d748-5104-4703-a230-f5d3931a56b2";
type Scope = "mine" | "review";
type ReportPage = { items: Report[]; count: number; next_offset: number | null };
const PAGE_SIZE = 20;

export function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem("weekly-user") || DEFAULT_USER);
  const [session, setSession] = useState<Session | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportCount, setReportCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scope, setScope] = useState<Scope>("mine");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [toast, setToast] = useState("");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadReports = useCallback(async (activeUser = userId, activeScope = scope) => {
    const result = await api<ReportPage>(`/api/reports?scope=${activeScope}&limit=${PAGE_SIZE}&offset=0`, activeUser);
    setReports(result.items);
    setReportCount(result.count);
  }, [scope, userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([api<Session>("/api/session", userId), api<ReportPage>(`/api/reports?scope=${scope}&limit=${PAGE_SIZE}&offset=0`, userId)])
      .then(([nextSession, result]) => {
        if (!cancelled) { setSession(nextSession); setReports(result.items); setReportCount(result.count); }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "应用加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, scope]);

  function switchUser(user: User) {
    localStorage.setItem("weekly-user", user.id);
    setSelectedId(null);
    setUserMenu(false);
    setUserId(user.id);
  }

  function switchScope(next: Scope) {
    setSelectedId(null);
    setScope(next);
  }

  async function refresh() {
    await loadReports();
    const nextSession = await api<Session>("/api/session", userId);
    setSession(nextSession);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await api<ReportPage>(`/api/reports?scope=${scope}&limit=${PAGE_SIZE}&offset=${reports.length}`, userId);
      setReports((current) => [...current, ...result.items]);
      setReportCount(result.count);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !session) return <div className="loading-screen"><div className="loading-mark"><strong>周</strong><span>正在连接组织与周报服务</span></div></div>;
  if (error || !session) return <div className="error-banner"><div><h2>暂时无法打开应用</h2><p>{error || "未获取到用户上下文"}</p></div><button className="primary-button" onClick={() => location.reload()}>重新加载</button></div>;

  const stats = session.stats;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="周报协作"><div className="brand-mark"><BookOpen size={20} strokeWidth={2.2} /></div><div><strong>周报协作</strong></div></div>
        <div className="sidebar-main">
          <nav className="sidebar-nav" aria-label="主要导航">
            <button className={`nav-item ${scope === "mine" ? "active" : ""}`} onClick={() => switchScope("mine")}>
              <span className="nav-index">01</span><FilePlus2 className="nav-icon" size={19} />
              <span className="nav-copy"><strong>我的周报</strong><small>提交与回顾个人进展</small></span><span className="nav-count">{stats.mine}</span>
            </button>
            <button className={`nav-item ${scope === "review" ? "active" : ""}`} onClick={() => switchScope("review")}>
              <span className="nav-index">02</span><Users className="nav-icon" size={19} />
              <span className="nav-copy"><strong>待我审阅</strong><small>查看需要反馈的周报</small></span><span className="nav-count">{stats.review}</span>
            </button>
          </nav>
        </div>
        <div className="sidebar-note"><div><Bot size={18} /></div><strong>Agent</strong></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="user-menu-wrap">
            {session.demo_mode ? <>
              <button className="user-switch" onClick={() => setUserMenu(!userMenu)} aria-expanded={userMenu}><Avatar name={session.current_user.name} /><span><strong>{session.current_user.name}</strong><small>{session.current_user.email}</small></span><ChevronDown size={15} /></button>
              {userMenu ? <div className="user-menu">{session.users.map((user) => <button key={user.id} onClick={() => switchUser(user)}><Avatar name={user.name} /><span><strong>{user.name}</strong><small>{user.email}</small></span>{user.id === userId ? <span>当前</span> : null}</button>)}</div> : null}
            </> : <div className="user-switch is-static"><Avatar name={session.current_user.name} /><span><strong>{session.current_user.name}</strong><small>{session.current_user.email}</small></span></div>}
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div><span className="eyebrow">{scope === "mine" ? "个人进展" : "团队反馈"}</span><h1>{scope === "mine" ? "我的周报" : "待我审阅"}</h1></div>
            <p>{scope === "mine" ? "记录每周成果、风险与下一步行动，让进展清楚地被看见。" : "查看组织关系内下属的周报，留下具体、可执行的反馈。"}</p>
            {scope === "mine" ? <button className="primary-button" onClick={() => setCreating(true)}><Plus size={17} />提交周报</button> : null}
          </section>

          <section className="metric-grid" aria-label="周报概览">
            <Metric index="01" value={stats.mine} label="累计提交" />
            <Metric index="02" value={stats.review} label="可审阅周报" />
            <Metric index="03" value={stats.comments} label="已发表反馈" />
          </section>

          <section>
            <div className="section-toolbar"><h2>{scope === "mine" ? "提交记录" : "审阅队列"}</h2><span>{reportCount} 份周报</span></div>
            {reports.length ? <div className="report-list">{reports.map((report) => <ReportRow key={report.id} report={report} onOpen={() => setSelectedId(report.id)} />)}</div>
              : <Empty icon={scope === "mine" ? <FilePlus2 size={28} /> : <MessageSquare size={28} />} title={scope === "mine" ? "还没有提交记录" : "当前没有待审阅周报"} body={scope === "mine" ? "提交第一份周报后，你的所有直接与间接上级都可以查看。" : "组织关系内出现新的下属周报时，会显示在这里。"} />}
            {reports.length < reportCount ? <div className="load-more"><button className="secondary-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="spin" size={16} /> : null}{loadingMore ? "正在加载" : "加载更多"}</button></div> : null}
          </section>
        </div>
      </main>

      {creating ? <CreateReportModal userId={userId} onClose={() => setCreating(false)} onCreated={(report: ReportDetail) => { setCreating(false); setSelectedId(report.id); void refresh(); notify("周报已提交并同步可见权限"); }} /> : null}
      {selectedId ? <ReportDrawer reportId={selectedId} userId={userId} onClose={() => setSelectedId(null)} onChanged={() => void refresh()} onDeleted={() => { setSelectedId(null); void refresh(); }} notify={notify} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function ReportRow({ report, onOpen }: { report: Report; onOpen: () => void }) {
  return <button className="report-row" onClick={onOpen}>
    <span className="week-folio"><span>WEEK</span><strong>{weekNumber(report.week_start)}</strong></span>
    <span className="report-copy"><h3>{report.title}</h3><p>{report.content}</p><span className="report-author"><Avatar name={report.author_name} />{report.author_name}</span></span>
    <span className="report-meta"><span>{formatWeek(report.week_start)}</span><span><MessageSquare size={14} />{report.comment_count} 条评论</span><span>提交于 {formatDate(report.created_at)}</span></span>
    <ArrowRight className="row-arrow" size={20} />
  </button>;
}
