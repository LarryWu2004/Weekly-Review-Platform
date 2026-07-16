import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, Bot, FileText, LoaderCircle, Send, Sparkles, Trash2, Users, X } from "lucide-react";
import { api, downloadAttachment } from "./api";
import type { AgentJob, Attachment, Comment, ReportDetail } from "./types";
import { attachmentPreviewMode, attachmentPreviewUrl, Avatar, formatDate, formatFileSize, formatWeek, weekNumber } from "./ui";

export function ReportDrawer({ reportId, currentUserId, focusCommentId, onClose, onChanged, onDeleted, notify }: {
  reportId: string;
  currentUserId: string;
  focusCommentId?: string | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  notify: (message: string) => void;
}) {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setReport(null);
    setSelectedAttachmentId(null);
    setConfirmingDelete(false);
    api<ReportDetail>(`/api/reports/${reportId}`)
      .then((loaded) => {
        setReport(loaded);
        setSelectedAttachmentId(loaded.attachments[0]?.id || null);
      })
      .catch((error) => notify(error instanceof Error ? error.message : "加载失败"));
  }, [reportId, notify]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setConfirmingDelete(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmingDelete, deleting]);

  useEffect(() => {
    if (!report || !focusCommentId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`comment-${focusCommentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [report, focusCommentId]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim() || !report) return;
    setCommenting(true);
    try {
      const created = await api<Comment>(`/api/reports/${report.id}/comments`, {
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
      let job = await api<AgentJob>(`/api/reports/${report.id}/analyze`, { method: "POST" });
      for (let attempt = 0; !["succeeded", "failed"].includes(job.status) && attempt < 100; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        job = await api<AgentJob>(`/api/agent-jobs/${job.id}`);
      }
      if (job.status !== "succeeded" || !job.analysis) throw new Error(job.error || "Agent 分析超时，请稍后重试");
      setReport({ ...report, analyses: [job.analysis, ...report.analyses] });
      onChanged();
      notify("Agent 分析已完成");
    } catch (error) {
      notify(error instanceof Error ? error.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  async function removeReport() {
    if (!report) return;
    setDeleting(true);
    try {
      await api<void>(`/api/reports/${report.id}`, { method: "DELETE" });
      notify("周报已删除");
      onDeleted();
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
      setDeleting(false);
    }
  }

  async function download(attachment: Attachment) {
    try { await downloadAttachment(attachment.id, attachment.original_name); }
    catch (error) { notify(error instanceof Error ? error.message : "下载失败"); }
  }

  const isAuthor = report?.author_user_id === currentUserId;
  const selectedAttachment = report?.attachments.find((item) => item.id === selectedAttachmentId) || report?.attachments[0] || null;

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="detail-workspace" role="dialog" aria-modal="true" aria-label="周报详情">
        {!report ? <div className="detail-loading"><LoaderCircle className="spin" /></div> : (
          <>
            <AttachmentPreview
              attachments={report.attachments}
              selected={selectedAttachment}
              onSelect={setSelectedAttachmentId}
              onDownload={(attachment) => void download(attachment)}
            />

            <div className="detail-drawer">
              <div className="drawer-top">
                <div><button className="icon-button" onClick={onClose} aria-label="返回"><ArrowLeft size={19} /></button><span>周报详情</span></div>
                <div className="drawer-actions">
                  {isAuthor ? <button className="text-button danger-button" disabled={deleting} onClick={() => setConfirmingDelete(true)}><Trash2 size={16} />删除</button> : null}
                  <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
                </div>
              </div>
              <header className="detail-hero">
                <span className="detail-week">{weekNumber(report.week_start)}</span>
                <div className="eyebrow">{formatWeek(report.week_start)} <span className="status-mark">已提交</span></div>
                <h2>{report.title}</h2>
                <div className="detail-author"><Avatar name={report.author_name} /><div><strong>{report.author_name}</strong><span>{report.author_email}</span></div></div>
                {isAuthor ? <div className="viewer-line"><Users size={15} /><span>{Math.max(0, report.viewers.length - 1)} 位审阅人可查看</span></div> : null}
              </header>

              <section className="detail-section analysis-section">
                <div className="section-title-row">
                  <div><span className="section-index">01</span><h3>Agent 评阅</h3></div>
                  <button className="secondary-button" disabled={analyzing} onClick={() => void analyze()}>
                    {analyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{analyzing ? "正在分析" : report.analyses.length ? "重新分析" : "开始分析"}
                  </button>
                </div>
                {report.analyses.length ? <div className="analysis-result"><div className="analysis-meta"><Bot size={18} /><span>{formatDate(report.analyses[0].created_at)}</span></div><p>{report.analyses[0].answer}</p></div>
                  : <p className="section-empty">Agent 会结合本次及历史周报的附件文本和已有评论给出建议。</p>}
              </section>

              <section className="detail-section">
                <div className="section-title-row"><div><span className="section-index">02</span><h3>评论与反馈</h3></div><span className="count-label">{report.comments.length} 条</span></div>
                <div className="comment-list">
                  {report.comments.map((item) => <article id={`comment-${item.id}`} className={`comment ${focusCommentId === item.id ? "is-focused" : ""}`} key={item.id}><Avatar name={item.commenter_name} /><div><div className="comment-head"><strong>{item.commenter_name}</strong><time>{formatDate(item.created_at)}</time></div><p>{item.content}</p></div></article>)}
                  {!report.comments.length ? <p className="section-empty">暂无评论。</p> : null}
                </div>
                {!isAuthor ? <form className="comment-form" onSubmit={submitComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写下具体、可执行的反馈…" rows={3} /><button className="primary-button compact" disabled={!comment.trim() || commenting}>{commenting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}发表评论</button></form> : null}
              </section>
            </div>
          </>
        )}
      </div>

      {report && confirmingDelete ? (
        <div className="delete-confirm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !deleting && setConfirmingDelete(false)}>
          <div className="delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description">
            <div className="delete-confirm-icon"><Trash2 size={20} /></div>
            <div className="delete-confirm-copy">
              <span>删除周报</span>
              <h3 id="delete-confirm-title">确定删除这份周报？</h3>
              <p id="delete-confirm-description">“{report.title}”以及关联评论、Agent 分析和附件将一并删除，且无法恢复。</p>
            </div>
            <div className="delete-confirm-actions">
              <button className="secondary-button" autoFocus disabled={deleting} onClick={() => setConfirmingDelete(false)}>取消</button>
              <button className="confirm-delete-button" disabled={deleting} onClick={() => void removeReport()}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{deleting ? "正在删除" : "确认删除"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentPreview({ attachments, selected, onSelect, onDownload }: {
  attachments: Attachment[];
  selected: Attachment | null;
  onSelect: (id: string) => void;
  onDownload: (attachment: Attachment) => void;
}) {
  const mode = selected ? attachmentPreviewMode(selected.original_name) : "text";
  return (
    <section className={`attachment-preview-pane ${attachments.length > 1 ? "has-tabs" : ""}`} aria-label="附件预览">
      <header className="preview-toolbar">
        <div><span>附件预览</span><strong>{selected?.original_name || "暂无附件"}</strong></div>
        {selected ? <button className="secondary-button preview-download" onClick={() => onDownload(selected)}><ArrowDownToLine size={16} />下载</button> : null}
      </header>
      {attachments.length > 1 ? <nav className="attachment-tabs" aria-label="选择预览附件">{attachments.map((attachment, index) => (
        <button key={attachment.id} className={attachment.id === selected?.id ? "active" : ""} onClick={() => onSelect(attachment.id)}>
          <span>{String(index + 1).padStart(2, "0")}</span><strong>{attachment.original_name}</strong><small>{formatFileSize(attachment.size)}</small>
        </button>
      ))}</nav> : null}
      <div className="preview-stage">
        {!selected ? <div className="preview-empty"><FileText size={28} /><strong>暂无可预览附件</strong></div> : null}
        {selected && mode === "pdf" ? <iframe className="pdf-preview" title={`预览 ${selected.original_name}`} src={attachmentPreviewUrl(selected.id, mode)} /> : null}
        {selected && mode === "document" ? <iframe className="document-html-preview" sandbox="" title={`预览 ${selected.original_name}`} src={attachmentPreviewUrl(selected.id, mode)} /> : null}
        {selected && mode === "text" ? (
          <article className="document-preview-paper">
            <header><FileText size={17} /><span>附件文本内容</span></header>
            {selected.text_preview ? <pre>{selected.text_preview}</pre> : <div className="preview-empty"><FileText size={28} /><strong>暂时无法提取该附件的文本</strong><p>可下载原文件查看完整内容。</p></div>}
          </article>
        ) : null}
      </div>
    </section>
  );
}
