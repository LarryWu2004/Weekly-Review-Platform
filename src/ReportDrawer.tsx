import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, Bot, File, LoaderCircle, Send, Sparkles, Trash2, Users, X } from "lucide-react";
import { api, downloadAttachment } from "./api";
import type { AgentJob, Comment, ReportDetail } from "./types";
import { Avatar, formatDate, formatFileSize, formatWeek, weekNumber } from "./ui";

export function ReportDrawer({ reportId, userId, onClose, onChanged, onDeleted, notify }: {
  reportId: string;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  notify: (message: string) => void;
}) {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setReport(null);
    api<ReportDetail>(`/api/reports/${reportId}`, userId)
      .then(setReport)
      .catch((error) => notify(error instanceof Error ? error.message : "加载失败"));
  }, [reportId, userId, notify]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim() || !report) return;
    setCommenting(true);
    try {
      const created = await api<Comment>(`/api/reports/${report.id}/comments`, userId, {
        method: "POST", body: JSON.stringify({ content: comment }),
      });
      setReport({ ...report, comments: [...report.comments, created] });
      setComment("");
      onChanged();
      notify("评论已发表");
    } catch (error) {
      notify(error instanceof Error ? error.message : "评论失败");
    } finally {
      setCommenting(false);
    }
  }

  async function analyze() {
    if (!report) return;
    setAnalyzing(true);
    try {
      let job = await api<AgentJob>(`/api/reports/${report.id}/analyze`, userId, { method: "POST" });
      for (let attempt = 0; !["succeeded", "failed"].includes(job.status) && attempt < 100; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        job = await api<AgentJob>(`/api/agent-jobs/${job.id}`, userId);
      }
      if (job.status !== "succeeded" || !job.analysis) throw new Error(job.error || "Agent 分析超时，请稍后重试");
      const analysis = job.analysis;
      setReport({ ...report, analyses: [analysis, ...report.analyses] });
      onChanged();
      notify("Agent 分析已完成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  async function removeReport() {
    if (!report || !window.confirm(`确认删除“${report.title}”吗？周报、评论、分析和附件都将一并删除。`)) return;
    setDeleting(true);
    try {
      await api<void>(`/api/reports/${report.id}`, userId, { method: "DELETE" });
      notify("周报已删除");
      onDeleted();
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
      setDeleting(false);
    }
  }

  async function download(id: string, name: string) {
    try { await downloadAttachment(id, name, userId); }
    catch (error) { notify(error instanceof Error ? error.message : "下载失败"); }
  }

  const isAuthor = report?.author_user_id === userId;
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="detail-drawer" role="dialog" aria-modal="true" aria-label="周报详情">
        <div className="drawer-top">
          <div><button className="icon-button" onClick={onClose} aria-label="返回"><ArrowLeft size={19} /></button><span>周报详情</span></div>
          <div className="drawer-actions">
            {isAuthor ? <button className="text-button danger-button" disabled={deleting} onClick={() => void removeReport()}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}删除</button> : null}
            <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
          </div>
        </div>
        {!report ? <div className="detail-loading"><LoaderCircle className="spin" /></div> : (
          <div>
            <header className="detail-hero">
              <span className="detail-week">{weekNumber(report.week_start)}</span>
              <div className="eyebrow">{formatWeek(report.week_start)} <span className="status-mark">已提交</span></div>
              <h2>{report.title}</h2>
              <div className="detail-author"><Avatar name={report.author_name} /><div><strong>{report.author_name}</strong><span>{report.author_email}</span></div></div>
              {isAuthor ? <div className="viewer-line"><Users size={15} /><span>{Math.max(0, report.viewers.length - 1)} 位上级可查看</span></div> : null}
            </header>

            <section className="detail-section">
              <SectionTitle index="01" title="周报内容" />
              <p className="report-content">{report.content}</p>
              {report.attachments.length ? <div className="attachment-list">{report.attachments.map((attachment) => (
                <div className="attachment-item" key={attachment.id}>
                  <span><File size={18} /><span><strong>{attachment.original_name}</strong><small>{attachment.mime_type || "文件"} · {formatFileSize(attachment.size)}</small></span></span>
                  <button className="icon-button" onClick={() => void download(attachment.id, attachment.original_name)} aria-label={`下载 ${attachment.original_name}`}><ArrowDownToLine size={17} /></button>
                </div>
              ))}</div> : null}
            </section>

            <section className="detail-section analysis-section">
              <div className="section-title-row">
                <div><span className="section-index">02</span><h3>Agent 评阅</h3></div>
                {isAuthor ? <button className="secondary-button" disabled={analyzing} onClick={() => void analyze()}>
                  {analyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{analyzing ? "正在分析" : report.analyses.length ? "重新分析" : "开始分析"}
                </button> : null}
              </div>
              {report.analyses.length ? <div className="analysis-result"><div className="analysis-meta"><Bot size={18} /><span>{formatDate(report.analyses[0].created_at)}</span></div><p>{report.analyses[0].answer}</p></div>
                : <p className="section-empty">{isAuthor ? "Agent 会结合本次内容、历史周报、附件文本和上级评论给出建议。" : "作者尚未发起 Agent 分析。"}</p>}
            </section>

            <section className="detail-section">
              <div className="section-title-row"><div><span className="section-index">03</span><h3>评论与反馈</h3></div><span className="count-label">{report.comments.length} 条</span></div>
              <div className="comment-list">
                {report.comments.map((item) => <article className="comment" key={item.id}><Avatar name={item.commenter_name} /><div><div className="comment-head"><strong>{item.commenter_name}</strong><time>{formatDate(item.created_at)}</time></div><p>{item.content}</p></div></article>)}
                {!report.comments.length ? <p className="section-empty">暂无评论。</p> : null}
              </div>
              {!isAuthor ? <form className="comment-form" onSubmit={submitComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写下具体、可执行的反馈…" rows={3} /><button className="primary-button compact" disabled={!comment.trim() || commenting}>{commenting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}发表评论</button></form> : null}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return <div className="section-title-row"><div><span className="section-index">{index}</span><h3>{title}</h3></div></div>;
}
