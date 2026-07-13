import { useState, type FormEvent } from "react";
import { Check, File, LoaderCircle, Paperclip, X } from "lucide-react";
import { api } from "./api";
import type { ReportDetail } from "./types";
import { currentMonday } from "./ui";

export function CreateReportModal({ userId, onClose, onCreated }: {
  userId: string;
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
      onCreated(await api<ReportDetail>("/api/reports", userId, { method: "POST", body: formData }));
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
          <label className="content-field">
            <span>本周工作与下周计划</span>
            <textarea required name="content" rows={12} placeholder={"建议包含：\n1. 已完成事项与可衡量结果\n2. 风险、阻塞与需要的支持\n3. 下周目标与负责人"} />
          </label>
          <label className="upload-zone">
            <input type="file" multiple hidden onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 5))} />
            <Paperclip size={20} /><span><strong>添加附件</strong>　单个文件不超过 10 MB，最多 5 个</span>
          </label>
          {files.length ? <div className="selected-files">{files.map((file) => <span key={`${file.name}-${file.size}`}><File size={14} />{file.name}</span>)}</div> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <footer className="form-actions">
            <p>提交后，组织关系中的所有上级将获得查看权限。</p>
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
