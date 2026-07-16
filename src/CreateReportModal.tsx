import { useState, type FormEvent } from "react";
import { Check, FileText, LoaderCircle, UploadCloud, X } from "lucide-react";
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
    if (!files.length) {
      setError("请上传至少一个周报附件");
      return;
    }
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
          <label className="upload-zone">
            <input type="file" multiple hidden accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.json,.log,.xml,.html" onChange={(event) => {
              setFiles(Array.from(event.target.files || []).slice(0, 5));
              setError("");
            }} />
            <span className="upload-zone-icon"><UploadCloud size={26} /></span>
            <span className="upload-zone-copy"><strong>上传周报附件</strong><small>支持 Word、PDF、Excel 和文本文件；单个不超过 10 MB，最多 5 个</small></span>
            <span className="upload-zone-action">选择文件</span>
          </label>
          {files.length ? <div className="selected-files">{files.map((file) => <span key={`${file.name}-${file.size}`}><FileText size={15} /><span>{file.name}</span><small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></span>)}</div> : <p className="upload-required-note">周报内容将从附件中提取，并用于页面预览和 Agent 分析。</p>}
          {error ? <p className="form-error">{error}</p> : null}
          <footer className="form-actions">
            <p>提交后，组织关系中具备审阅权限的相关成员将获得查看权限。</p>
            <div>
              <button type="button" className="text-button" onClick={onClose}>取消</button>
              <button className="primary-button" disabled={submitting || !files.length}>
                {submitting ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{submitting ? "提交中" : "提交周报"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
