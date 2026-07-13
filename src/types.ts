export type User = { id: string; name: string; email: string };

export type Session = {
  current_user: User;
  users: User[];
  stats: { mine: number; review: number; comments: number };
  capabilities: string[];
  demo_mode: boolean;
};

export type Report = {
  id: string;
  author_user_id: string;
  author_name: string;
  author_email: string;
  week_start: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  viewer_depth: number | null;
  comment_count: number;
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
