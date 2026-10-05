import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { thumbUrl } from "../api/client";
import type { Job, Tool } from "../api/types";
import {
  TOOL_LABELS,
  TOOL_PATHS,
  cx,
  daysUntil,
  formatBytes,
  formatChange,
  formatDate,
  formatDims,
  summarizeParams,
} from "../lib/format";
import { JobStatusBadge, ProgressBar } from "./ui";

export function jobExpired(job: Job): boolean {
  return job.status === "done" && !!job.output_asset && !job.output_asset.file_available;
}

export function Thumb({ assetId, available = true, className }: { assetId?: string | null; available?: boolean; className?: string }) {
  return (
    <div className={cx("checker flex items-center justify-center overflow-hidden rounded-lg bg-slate-100", className)}>
      {assetId && available ? (
        <img src={thumbUrl(assetId)} alt="" loading="lazy" className="size-full object-contain" />
      ) : (
        <span className="text-xs text-slate-400">{available ? "미리보기 없음" : "만료"}</span>
      )}
    </div>
  );
}

/** "이어서 작업" 메뉴: 결과 이미지를 다른 기능의 입력으로 넘긴다 */
export function ContinueMenu({ jobs, className, align = "right" }: { jobs: Job[]; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const outputs = jobs.filter((j) => j.output_asset?.file_available).map((j) => j.output_asset!.id);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (!outputs.length) return null;
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button className="btn-secondary w-full" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        이어서 작업
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
          <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div
          className={cx(
            "absolute z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {(Object.keys(TOOL_LABELS) as Tool[]).map((tool) => (
            <button
              key={tool}
              className="block min-h-11 w-full px-4 text-left text-sm hover:bg-slate-50"
              onClick={() => navigate(`${TOOL_PATHS[tool]}?assets=${outputs.join(",")}`)}
            >
              {TOOL_LABELS[tool]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SizeSummary({ job }: { job: Job }) {
  const inp = job.input_asset;
  const out = job.output_asset;
  return (
    <div className="text-xs text-slate-500">
      <span>
        {formatDims(inp.width, inp.height)} · {formatBytes(inp.size_bytes)}
      </span>
      {out && (
        <>
          <span className="mx-1">→</span>
          <span className="font-medium text-slate-700">
            {formatDims(out.width, out.height)} · {formatBytes(out.size_bytes)}
          </span>
          <span
            className={cx("ml-1 font-semibold", out.size_bytes < inp.size_bytes ? "text-emerald-600" : "text-slate-500")}
          >
            ({formatChange(inp.size_bytes, out.size_bytes)})
          </span>
        </>
      )}
    </div>
  );
}

export function JobCard({
  job,
  selected,
  onSelect,
  showUser = false,
}: {
  job: Job;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  showUser?: boolean;
}) {
  const expired = jobExpired(job);
  const days = daysUntil(job.output_asset?.expires_at ?? job.input_asset.expires_at);
  const thumbAsset = job.output_asset?.file_available ? job.output_asset : job.input_asset;
  return (
    <div className={cx("card relative flex gap-3 p-3 transition", selected && "ring-2 ring-brand-500")}>
      {onSelect && (
        <label className="absolute top-1 left-1 z-10 flex size-11 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="size-5 accent-brand-600"
            checked={!!selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`${job.input_asset.original_filename} 선택`}
          />
        </label>
      )}
      <Link to={`/history/${job.id}`} className="shrink-0">
        <Thumb assetId={thumbAsset?.id} available={thumbAsset?.file_available} className="size-20 sm:size-24" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge bg-brand-50 text-brand-700">{TOOL_LABELS[job.tool]}</span>
          <JobStatusBadge status={job.status} expired={expired} />
          {job.deleted_at && <span className="badge bg-slate-200 text-slate-600">삭제됨</span>}
          {!expired && job.status === "done" && days !== null && days <= 7 && (
            <span className="badge bg-amber-50 text-amber-700">D-{Math.max(0, days)} 만료</span>
          )}
        </div>
        <Link to={`/history/${job.id}`} className="mt-1 block truncate text-sm font-semibold text-slate-900 hover:underline">
          {job.input_asset.original_filename ?? "이미지"}
        </Link>
        <div className="truncate text-xs text-slate-500">{summarizeParams(job.tool, job.params)}</div>
        <SizeSummary job={job} />
        {(job.status === "processing" || job.status === "queued") && <ProgressBar value={job.progress} className="mt-2" />}
        {job.status === "failed" && job.error_message && (
          <div className="mt-1 line-clamp-2 text-xs text-red-600">{job.error_message}</div>
        )}
        <div className="mt-1 text-xs text-slate-400">
          {formatDate(job.created_at)}
          {showUser && job.user && <span className="ml-2 text-slate-500">· {job.user.email}</span>}
        </div>
      </div>
    </div>
  );
}
