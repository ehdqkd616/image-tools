import { Link } from "react-router";
import type { Tool } from "../../api/types";
import { ErrorBox, PageLoader } from "../../components/ui";
import { TOOL_LABELS, formatBytes } from "../../lib/format";
import { useAdminStats } from "./AdminLayout";

function Stat({ label, value, to, tone }: { label: string; value: string | number; to?: string; tone?: "warn" }) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
    </>
  );
  return to ? (
    <Link to={to} className="card p-4 transition hover:border-brand-500">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

const TOOL_COLORS: Record<Tool, string> = { upscale: "bg-violet-500", resize: "bg-sky-500", compress: "bg-emerald-500" };

export function AdminDashboard() {
  const { data: s, isLoading, error } = useAdminStats();
  if (isLoading) return <PageLoader />;
  if (error || !s) return <ErrorBox error={error} />;

  const toolTotal = Object.values(s.jobs_by_tool_30d).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">관리자 대시보드</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="승인 대기 회원" value={s.pending_users} to="/admin/users" tone={s.pending_users ? "warn" : undefined} />
        <Stat label="오늘 작업" value={s.jobs_today.toLocaleString()} to="/admin/jobs" />
        <Stat label="최근 7일 작업" value={s.jobs_week.toLocaleString()} />
        <Stat label="최근 7일 실패율" value={`${(s.failure_rate_week * 100).toFixed(1)}%`} tone={s.failure_rate_week > 0.1 ? "warn" : undefined} />
        <Stat label="큐 대기 작업" value={s.queued_jobs} />
        <Stat label="처리 중" value={s.processing_jobs} />
        <Stat label="전체 저장 용량" value={formatBytes(s.storage_used_bytes)} />
        <Stat label="승인된 회원" value={s.users_by_status.approved ?? 0} />
      </div>

      <section className="card p-5">
        <h2 className="mb-4 font-bold">기능별 작업 비율 (최근 30일)</h2>
        {toolTotal === 0 ? (
          <p className="text-sm text-slate-500">아직 작업이 없습니다.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
              {(Object.keys(TOOL_LABELS) as Tool[]).map((t) => (
                <div key={t} className={TOOL_COLORS[t]} style={{ width: `${((s.jobs_by_tool_30d[t] ?? 0) / toolTotal) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              {(Object.keys(TOOL_LABELS) as Tool[]).map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className={`size-3 rounded-sm ${TOOL_COLORS[t]}`} />
                  <span className="text-slate-600">{TOOL_LABELS[t]}</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {(s.jobs_by_tool_30d[t] ?? 0).toLocaleString()}건 ({Math.round(((s.jobs_by_tool_30d[t] ?? 0) / toolTotal) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {Object.keys(s.queue_lengths).length > 0 && (
        <p className="text-xs text-slate-500">
          Redis 큐 길이: {Object.entries(s.queue_lengths).map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
