export type Tool = "upscale" | "resize" | "compress";
export type JobStatus = "queued" | "processing" | "done" | "failed" | "canceled";
export type UserStatus = "pending" | "approved" | "rejected" | "suspended";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  status: UserStatus;
  storage_quota_bytes: number;
  storage_used_bytes: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUser extends User {
  signup_note: string | null;
  reject_reason: string | null;
  approved_at: string | null;
  job_count: number;
}

export interface Asset {
  id: string;
  kind: "original" | "result";
  original_filename: string | null;
  mime_type: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number;
  expires_at: string | null;
  created_at: string;
  file_available: boolean;
}

export interface UpscaleParams {
  scale: 2 | 4;
  style: "photo" | "illust";
  denoise: "none" | "low" | "medium" | "high";
  format: "png" | "webp" | "jpg";
  face: boolean;
}

export type OutputFormat = "original" | "jpg" | "png" | "webp";

export interface ResizeParams {
  mode: "pixel" | "percent";
  width: number | null;
  height: number | null;
  percent: number | null;
  lock_ratio: boolean;
  fit: "contain" | "stretch" | "cover";
  format: OutputFormat;
  quality: number;
  preset: string | null;
}

export interface CompressParams {
  mode: "quality" | "target_size";
  quality: number;
  target_bytes: number | null;
  format: OutputFormat;
  max_side: number | null;
  strip_metadata: boolean;
  png_colors: 0 | 256 | 128 | 64 | 32 | 16;
  allow_downscale: boolean;
}

export type ToolParams = UpscaleParams | ResizeParams | CompressParams;

export interface JobResult {
  engine?: string;
  quality?: number | null;
  png_colors?: number;
  target_bytes?: number;
  target_met?: boolean;
  downscaled?: boolean;
  kept_original?: boolean;
  larger_than_original?: boolean;
  upscaled?: boolean;
}

export interface Job {
  id: string;
  tool: Tool;
  params: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  error_message: string | null;
  result: JobResult | null;
  batch_id: string | null;
  parent_job_id: string | null;
  input_asset: Asset;
  output_asset: Asset | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  deleted_at: string | null;
  queue_position: number | null;
  user: { id: string; email: string; name: string } | null;
}

export interface JobDetail extends Job {
  parent: Job | null;
  children: Job[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Preset {
  id: string;
  group: string;
  label: string;
  width: number;
  height: number;
}

export interface Limits {
  max_upload_mb: number;
  max_files_per_request: number;
  upscale_max_input_pixels_2x: number;
  upscale_max_input_pixels_4x: number;
  upscale_max_output_side: number;
  file_retention_days: number;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

export interface AdminStats {
  pending_users: number;
  users_by_status: Partial<Record<UserStatus, number>>;
  jobs_today: number;
  jobs_week: number;
  jobs_by_tool_30d: Partial<Record<Tool, number>>;
  failure_rate_week: number;
  queued_jobs: number;
  processing_jobs: number;
  queue_lengths: Record<string, number>;
  storage_used_bytes: number;
}
