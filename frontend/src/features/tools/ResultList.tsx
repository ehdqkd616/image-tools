import { useState } from "react";
import { Link } from "react-router";
import { fileUrl, thumbUrl } from "../../api/client";
import type { Job } from "../../api/types";
import { CompareSlider } from "../../components/CompareSlider";
import { ContinueMenu, Thumb } from "../../components/JobCard";
import { JobStatusBadge, ProgressBar } from "../../components/ui";
import { cx, formatBytes, formatChange, formatDims } from "../../lib/format";

export function resultNote(job: Job): string | null {
  const r = job.result;
  if (!r) return null;
  if (r.kept_original) return "이미 최적화된 이미지라 원본을 유지했습니다.";
  if (r.target_met === false) return "목표 용량까지 줄이지 못해 가장 근접한 결과를 저장했습니다.";
  if (r.downscaled) return "목표 용량을 맞추기 위해 해상도를 줄였습니다.";
  if (r.larger_than_original) return "결과가 원본보다 큽니다. 다른 형식이나 품질을 시도해 보세요.";
  if (r.engine === "lanczos" && job.tool === "upscale") return "개발용 대체 엔진(LANCZOS)으로 처리했습니다.";
  return null;
}

export function CompareView({ job, fullRes }: { job: Job; fullRes: boolean }) {
  const out = job.output_asset;
  if (!out || !out.file_available) return null;
  const src = (id: string) => (fullRes ? fileUrl(id) : thumbUrl(id));
  return (
    <CompareSlider
      before={job.input_asset.file_available ? src(job.input_asset.id) : src(out.id)}
      after={src(out.id)}
      aspect={out.width && out.height ? out.width / out.height : undefined}
    />
  );
}

function ResultRow({ job, expanded, onToggle }: { job: Job; expanded: boolean; onToggle: () => void }) {
  const [fullRes, setFullRes] = useState(false);
  const inp = job.input_asset;
  const out = job.output_asset;
  const note = resultNote(job);
  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button onClick={onToggle} className="shrink-0" aria-expanded={expanded} aria-label="전/후 비교 보기">
          <Thumb assetId={(out ?? inp).id} available={(out ?? inp).file_available} className="size-16" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{inp.original_filename}</span>
            <JobStatusBadge status={job.status} />
          </div>
          {job.status === "done" && out ? (
            <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-slate-500 sm:flex sm:gap-3">
              <span>
                {formatDims(inp.width, inp.height)} → <b className="text-slate-700">{formatDims(out.width, out.height)}</b>
              </span>
              <span>
                {formatBytes(inp.size_bytes)} → <b className="text-slate-700">{formatBytes(out.size_bytes)}</b>{" "}
                <span className={cx("font-semibold", out.size_bytes < inp.size_bytes ? "text-emerald-600" : "text-slate-500")}>
                  ({formatChange(inp.size_bytes, out.size_bytes)})
                </span>
              </span>
            </div>
          ) : job.status === "failed" ? (
            <div className="mt-0.5 text-xs text-red-600">{job.error_message}</div>
          ) : (
            <div className="mt-1.5">
              <ProgressBar value={job.progress} />
              <div className="mt-1 text-xs text-slate-500">
                {job.status === "queued"
                  ? job.queue_position
                    ? `대기 ${job.queue_position}번째`
                    : "대기 중"
                  : `처리 중 ${job.progress}%`}
              </div>
            </div>
          )}
          {note && <div className="mt-1 text-xs text-amber-700">{note}</div>}
        </div>
        {job.status === "done" && out && (
          <a href={fileUrl(out.id, true)} className="btn-primary btn-sm shrink-0" download>
            다운로드
          </a>
        )}
      </div>
      {expanded && job.status === "done" && (
        <div className="border-t border-slate-100 p-3">
          <CompareView job={job} fullRes={fullRes} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="mr-auto flex min-h-11 items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="size-4 accent-brand-600" checked={fullRes} onChange={(e) => setFullRes(e.target.checked)} />
              원본 해상도로 비교
            </label>
            <Link to={`/history/${job.id}`} className="btn-ghost btn-sm">
              상세
            </Link>
            <ContinueMenu jobs={[job]} />
          </div>
        </div>
      )}
    </li>
  );
}

export function ResultList({ jobs }: { jobs: Job[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const firstDone = jobs.find((j) => j.status === "done")?.id ?? null;
  const open = expanded ?? firstDone;
  const done = jobs.filter((j) => j.status === "done");
  return (
    <>
      <ul className="space-y-3">
        {jobs.map((j) => (
          <ResultRow key={j.id} job={j} expanded={open === j.id} onToggle={() => setExpanded(open === j.id ? "" : j.id)} />
        ))}
      </ul>
      {done.length > 1 && (
        <div className="mt-4 flex justify-end">
          <ContinueMenu jobs={done} className="w-full sm:w-56" />
        </div>
      )}
    </>
  );
}
