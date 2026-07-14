import { useState, type FormEvent } from "react";
import { Check, File, LoaderCircle, Paperclip, X } from "lucide-react";
import { api } from "./api";
import type { ReportDetail } from "./types";
import { currentMonday } from "./ui";

export function CreateReportModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (report: ReportDetail) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    files.forEach((file) => formData.append("attachments", file));
    try {
      onCreated(await api<ReportDetail>("/api/reports", { method: "POST", body: formData }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="create-header">
          <div><span>新建</span><h2 id="create-title">提交本周周报</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label><span>周起始日</span><input required type="date" name="week_start" defaultValue={currentMonday()} /></label>
            <label><span>标题</span><input required name="title" placeholder="例如：第 30 周周报" maxLength={80} /></label>
          </div>
          <div className="report-editor-stack">
            <label className="content-field report-editor">
              <span className="report-editor-heading"><em>01</em><span><strong>本周工作</strong><small>记录已完成事项、成果以及风险阻塞</small></span></span>
              <textarea required name="current_work" rows={7} maxLength={30000} placeholder={"例如：\n1. 已完成事项与可衡量结果\n2. 当前风险、阻塞和需要的支持"} />
            </label>
            <label className="content-field report-editor">
              <span className="report-editor-heading"><em>02</em><span><strong>下周计划</strong><small>明确下一步目标、行动和负责人</small></span></span>
              <textarea required name="next_plan" rows={5} maxLength={20000} placeholder={"例如：\n1. 下周目标与验收标准\n2. 具体行动、负责人和完成时间"} />
            </label>
          </div>
          <label className="upload-zone">
            <input type="file" multiple hidden onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 5))} />
            <Paperclip size={20} /><span><strong>添加附件</strong>　单个文件不超过 10 MB，最多 5 个</span>
          </label>
          {files.length ? <div className="selected-files">{files.map((file) => <span key={`${file.name}-${file.size}`}><File size={14} />{file.name}</span>)}</div> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <footer className="form-actions">
            <p>提交后，组织关系中具备审阅权限的相关成员将获得查看权限。</p>
            <div>
              <button type="button" className="text-button" onClick={onClose}>取消</button>
              <button className="primary-button" disabled={submitting}>
                {submitting ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{submitting ? "提交中" : "提交周报"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
