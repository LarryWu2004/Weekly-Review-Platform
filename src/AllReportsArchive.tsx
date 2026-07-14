import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { FileSearch, LoaderCircle } from "lucide-react";
import { api } from "./api";
import type { Report } from "./types";
import { Empty } from "./ui";

type ReportScope = "mine" | "review";
type ReportPage = { items: Report[]; count: number; next_offset: number | null };
type Filters = { keyword: string; author: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { keyword: "", author: "", from: "", to: "" };
const PAGE_SIZE = 20;

export function AllReportsArchive({ scope, onClose, renderReport, notify }: {
  scope: ReportScope;
  onClose: () => void;
  renderReport: (report: Report) => ReactNode;
  notify: (message: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [reports, setReports] = useState<Report[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextFilters: Filters, offset = 0, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const query = new URLSearchParams({ scope, limit: String(PAGE_SIZE), offset: String(offset) });
      if (nextFilters.keyword.trim()) query.set("q", nextFilters.keyword.trim());
      if (nextFilters.author.trim()) query.set("author", nextFilters.author.trim());
      if (nextFilters.from) query.set("from", nextFilters.from);
      if (nextFilters.to) query.set("to", nextFilters.to);
      const result = await api<ReportPage>(`/api/reports?${query.toString()}`);
      setReports((current) => append ? [...current, ...result.items] : result.items);
      setCount(result.count);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "周报查询失败");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [notify, scope]);

  useEffect(() => {
    const initial = { ...EMPTY_FILTERS };
    setFilters(initial);
    setAppliedFilters(initial);
    void load(initial);
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) {
      notify("开始日期不能晚于结束日期");
      return;
    }
    const next = { ...filters };
    setAppliedFilters(next);
    void load(next);
  }

  function reset() {
    const next = { ...EMPTY_FILTERS };
    setFilters(next);
    setAppliedFilters(next);
    void load(next);
  }

  const title = scope === "mine" ? "所有我的周报" : "所有审阅周报";
  const description = scope === "mine"
    ? "检索本人历次提交记录，可按标题内容、人员和周报日期缩小范围。"
    : "检索当前组织权限内可审阅的周报，不会展示权限范围外的记录。";

  return <div className="page-content archive-page">
    <section className="archive-heading">
      <div><span className="eyebrow">周报档案</span><h1>{title}</h1><p>{description}</p></div>
      <button className="archive-back-button" onClick={onClose}>返回当前列表</button>
    </section>

    <form className="archive-filters" onSubmit={submit}>
      <label className="archive-field archive-keyword"><span>关键词</span><input value={filters.keyword} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} placeholder="搜索标题或周报内容" /></label>
      <label className="archive-field"><span>提交人</span><input value={filters.author} onChange={(event) => setFilters({ ...filters, author: event.target.value })} placeholder="姓名、邮箱或用户 ID" /></label>
      <label className="archive-field"><span>开始日期</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label className="archive-field"><span>结束日期</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <div className="archive-filter-actions"><button type="button" className="archive-reset-button" onClick={reset}>重置</button><button type="submit" className="primary-button">查询周报</button></div>
    </form>

    <section>
      <div className="section-toolbar archive-results-toolbar"><h2>筛选结果</h2><span>{count} 份周报</span></div>
      {loading ? <div className="archive-loading"><LoaderCircle className="spin" size={22} /><span>正在查询周报</span></div>
        : reports.length ? <div className="report-list">{reports.map((report) => renderReport(report))}</div>
          : <Empty icon={<FileSearch size={28} />} title="没有符合条件的周报" body="可以调整关键词、提交人或日期范围后重新查询。" />}
      {reports.length < count ? <div className="load-more"><button className="secondary-button" disabled={loadingMore} onClick={() => void load(appliedFilters, reports.length, true)}>{loadingMore ? <LoaderCircle className="spin" size={16} /> : null}{loadingMore ? "正在加载" : "加载更多"}</button></div> : null}
    </section>
  </div>;
}
