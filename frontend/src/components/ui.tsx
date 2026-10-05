import { useEffect, useRef, type ReactNode } from "react";
import type { JobStatus, UserStatus } from "../api/types";
import { STATUS_LABELS, cx, formatBytes } from "../lib/format";

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin text-current", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-20 text-brand-600" role="status" aria-label="불러오는 중">
      <Spinner className="size-8" />
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cx("rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700", className)}>
      {message}
    </div>
  );
}

export function Notice({ children, tone = "info", className }: { children: ReactNode; tone?: "info" | "warn"; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-lg px-4 py-3 text-sm",
        tone === "info" ? "bg-brand-50 text-brand-700" : "border border-amber-200 bg-amber-50 text-amber-800",
        className,
      )}
    >
      {children}
    </div>
  );
}

const JOB_BADGE: Record<JobStatus, string> = {
  queued: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  canceled: "bg-slate-100 text-slate-500",
};

export function JobStatusBadge({ status, expired }: { status: JobStatus; expired?: boolean }) {
  if (expired && status === "done") return <span className="badge bg-amber-100 text-amber-800">파일 만료</span>;
  return <span className={cx("badge", JOB_BADGE[status])}>{STATUS_LABELS[status]}</span>;
}

const USER_BADGE: Record<UserStatus, [string, string]> = {
  pending: ["승인 대기", "bg-amber-100 text-amber-800"],
  approved: ["승인", "bg-emerald-100 text-emerald-700"],
  rejected: ["거절", "bg-red-100 text-red-700"],
  suspended: ["정지", "bg-slate-200 text-slate-700"],
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const [label, cls] = USER_BADGE[status];
  return <span className={cx("badge", cls)}>{label}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div
      className={cx("h-2 overflow-hidden rounded-full bg-slate-200", className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}

export function StorageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-slate-600">저장 용량</span>
        <span className={cx("font-medium", pct >= 90 ? "text-red-600" : "text-slate-800")}>
          {formatBytes(used)} / {formatBytes(quota)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={cx("h-full rounded-full", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-600")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <nav className="mt-6 flex items-center justify-center gap-1" aria-label="페이지">
      <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        이전
      </button>
      {nums.map((n) => (
        <button
          key={n}
          className={cx("btn-sm btn min-w-9", n === page ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}
          aria-current={n === page ? "page" : undefined}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        다음
      </button>
    </nav>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="p-6">
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** 모바일에서 스크롤 끝에 닿으면 onVisible 호출 (무한 스크롤) */
export function InfiniteTrigger({ onVisible, disabled }: { onVisible: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onVisible(), {
      rootMargin: "300px",
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [onVisible, disabled]);
  return <div ref={ref} className="h-8" />;
}
