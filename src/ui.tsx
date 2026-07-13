import type { ReactNode } from "react";

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{name.trim().slice(0, 2).toUpperCase()}</span>;
}

export function weekNumber(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, "0");
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatWeek(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function formatFileSize(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function Metric({ index, value, label }: { index: string; value: number; label: string }) {
  return <div className="metric"><span className="metric-index">{index}</span><div><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div></div>;
}

export function Empty({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="empty-state"><div>{icon}<h3>{title}</h3><p>{body}</p></div></div>;
}

export function currentMonday() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}
