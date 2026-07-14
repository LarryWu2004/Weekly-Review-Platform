export type User = { id: string; name: string; email: string };

export type Session = {
  current_user: User;
  stats: { mine: number; review: number; comments: number; unread_messages: number };
  capabilities: string[];
};

export type Message = {
  id: string;
  report_id: string;
  report_title: string;
  report_week_start: string;
  commenter_user_id: string;
  commenter_name: string;
  commenter_email: string;
  content: string;
  created_at: string;
  read_at: string | null;
};

export type Report = {
  id: string;
  author_user_id: string;
  author_name: string;
  author_email: string;
  week_start: string;
  title: string;
  content: string;
  current_work: string;
  next_plan: string;
  status: string;
  created_at: string;
  viewer_depth: number | null;
  comment_count: number;
  reviewer_comment_count: number;
  attachment_count: number;
  analysis_count: number;
};

export type Attachment = {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  text_preview: string;
  created_at: string;
};

export type Comment = {
  id: string;
  commenter_user_id: string;
  commenter_name: string;
  commenter_email: string;
  content: string;
  created_at: string;
};

export type Analysis = {
  id: string;
  status: string;
  answer: string;
  created_at: string;
};

export type AgentJob = {
  id: string;
  report_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  analysis: Analysis | null;
};

export type Viewer = User & {
  viewer_user_id: string;
  depth: number;
  relation_type: "author" | "direct" | "indirect";
};

export type ReportDetail = Report & {
  attachments: Attachment[];
  comments: Comment[];
  analyses: Analysis[];
  viewers: Viewer[];
};
