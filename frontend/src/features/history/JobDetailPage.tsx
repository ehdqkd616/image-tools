import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, fileUrl } from "../../api/client";
import type { Job, JobDetail } from "../../api/types";
import { ContinueMenu, JobCard, Thumb, jobExpired } from "../../components/JobCard";
import { useToast } from "../../components/Toast";
import { ErrorBox, JobStatusBadge, PageLoader, ProgressBar } from "../../components/ui";
import { useMe } from "../../hooks/useAuth";
import {
  TOOL_LABELS,
  TOOL_PATHS,
  daysUntil,
  formatBytes,
  formatChange,
  formatDate,
  formatDims,
  formatLabel,
  isTerminal,
} from "../../lib/format";
import { CompareView, resultNote } from "../tools/ResultList";

const PARAM_LABELS: Record<string, string> = {
  scale: "배율",
  style: "이미지 종류",
  denoise: "노이즈 제거",
  format: "저장 형식",
  face: "얼굴 보정",
  mode: "방식",
  width: "가로",
  height: "세로",
  percent: "비율",
  lock_ratio: "비율 잠금",
  fit: "맞춤 방식",
  quality: "품질",
  preset: "프리셋",
  target_bytes: "목표 용량",
  max_side: "긴 변 최대",
  strip_metadata: "메타데이터 제거",
  png_colors: "PNG 색상 수",
  allow_downscale: "해상도 줄이기 허용",
};
const VALUE_LABELS: Record<string, string> = {
  photo: "사진",
  illust: "일러스트·그림",
  none: "없음",
  low: "낮음",
  medium: "중간",
  high: "높음",
  pixel: "픽셀",
  quality: "품질 직접 조절",
  target_size: "목표 용량 맞춤",
  contain: "비율 유지",
  stretch: "늘이기",
  cover: "잘라서 채우기",
};

function paramValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (key === "format") return formatLabel(v);
  if (key === "target_bytes") return formatBytes(Number(v));
  if (key === "scale") return `${v}배`;
  if (key === "percent") return `${v}%`;
  if (key === "png_colors") return v ? `${v}색` : "줄이지 않음";
  if (["width", "height", "max_side"].includes(key)) return `${v}px`;
  if (key === "mode" && v === "percent") return "비율(%)";
  return VALUE_LABELS[String(v)] ?? String(v);
}

/** 해당 작업에 의미 있는 옵션만 표시 */
function relevant(job: Job, key: string): boolean {
  const p = job.params;
  const outFmt = job.output_asset?.format ?? p.format;
  if (job.tool === "compress") {
    if (key === "quality") return p.mode === "quality" && outFmt !== "png";
    if (key === "target_bytes" || key === "allow_downscale") return p.mode === "target_size";
    if (key === "png_colors") return outFmt === "png" && p.mode === "quality";
  }
  if (job.tool === "resize") {
    if (key === "quality") return outFmt === "jpg" || outFmt === "webp";
    if (key === "percent") return p.mode === "percent";
    if (key === "fit") return p.mode === "pixel" && !!p.width && !!p.height;
    if (key === "lock_ratio") return false;
  }
  if (job.tool === "upscale" && key === "denoise") return p.style !== "illust";
  return true;
}

function duration(job: Job): string | null {
  if (!job.started_at || !job.finished_at) return null;
  const s = (new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`;
}

export function JobDetailPage() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [fullRes, setFullRes] = useState(false);

  const { data: job, error, isLoading } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && !isTerminal(q.state.data) ? 1500 : false),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const action = useMutation({
    mutationFn: (kind: "retry" | "cancel" | "delete") =>
      kind === "delete" ? api(`/jobs/${jobId}`, { method: "DELETE" }) : api(`/jobs/${jobId}/${kind}`, { method: "POST" }),
    onSuccess: (_, kind) => {
      if (kind === "delete") {
        toast("삭제했습니다.", "success");
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["me"] });
        navigate("/history", { replace: true });
      } else {
        toast(kind === "retry" ? "다시 시도합니다." : "취소했습니다.", "info");
        refresh();
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : "처리하지 못했습니다.", "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error || !job) return <ErrorBox error={error ?? "작업을 찾을 수 없습니다."} />;

  const owner = me?.id === job.user?.id || !job.user;
  const inp = job.input_asset;
  const out = job.output_asset;
  const expired = jobExpired(job);
  const days = daysUntil(out?.expires_at ?? inp.expires_at);
  const note = resultNote(job);

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate(-1)} className="mb-2 text-sm text-slate-500 hover:text-slate-800">
          ← 뒤로
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-brand-50 text-brand-700">{TOOL_LABELS[job.tool]}</span>
          <JobStatusBadge status={job.status} expired={expired} />
          {job.deleted_at && <span className="badge bg-slate-200 text-slate-600">삭제됨</span>}
        </div>
        <h1 className="mt-2 text-xl font-bold break-all">{inp.original_filename}</h1>
        <p className="text-sm text-slate-500">
          {formatDate(job.created_at)}
          {job.user && !owner && <span> · {job.user.email}</span>}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-3">
          {job.status === "done" && out?.file_available ? (
            <>
              <CompareView job={job} fullRes={fullRes} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" className="size-4 accent-brand-600" checked={fullRes} onChange={(e) => setFullRes(e.target.checked)} />
                원본 해상도로 비교 (이미지가 크면 느릴 수 있습니다)
              </label>
            </>
          ) : (
            <div className="card p-3">
              <Thumb assetId={inp.id} available={inp.file_available} className="aspect-[4/3] w-full" />
            </div>
          )}
          {(job.status === "queued" || job.status === "processing") && (
            <div className="card p-4">
              <ProgressBar value={job.progress} />
              <p className="mt-2 text-sm text-slate-600">
                {job.status === "queued" ? `대기 중${job.queue_position ? ` (${job.queue_position}번째)` : ""}` : `처리 중 ${job.progress}%`}
              </p>
            </div>
          )}
          {job.status === "failed" && <ErrorBox error={job.error_message ?? "처리에 실패했습니다."} />}
          {note && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{note}</p>}
          {expired && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">보관 기간이 지나 파일이 삭제되었습니다. 작업 기록만 남아 있습니다.</p>}
        </section>

        <aside className="space-y-4">
          <div className="card divide-y divide-slate-100 text-sm">
            <dl className="grid grid-cols-[5rem_1fr] gap-y-2 p-4">
              <dt className="text-slate-500">원본</dt>
              <dd>
                {formatDims(inp.width, inp.height)} · {formatBytes(inp.size_bytes)} · {formatLabel(inp.format)}
              </dd>
              {out && (
                <>
                  <dt className="text-slate-500">결과</dt>
                  <dd className="font-medium">
                    {formatDims(out.width, out.height)} · {formatBytes(out.size_bytes)} · {formatLabel(out.format)}
                  </dd>
                  <dt className="text-slate-500">용량 변화</dt>
                  <dd className={out.size_bytes < inp.size_bytes ? "font-semibold text-emerald-600" : ""}>
                    {formatChange(inp.size_bytes, out.size_bytes)}
                  </dd>
                </>
              )}
              {duration(job) && (
                <>
                  <dt className="text-slate-500">처리 시간</dt>
                  <dd>{duration(job)}</dd>
                </>
              )}
              {!expired && days !== null && job.status === "done" && (
                <>
                  <dt className="text-slate-500">보관</dt>
                  <dd className={days <= 7 ? "text-amber-700" : ""}>
                    {formatDate(out?.expires_at ?? inp.expires_at, false)}까지 (D-{Math.max(0, days)})
                  </dd>
                </>
              )}
            </dl>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 p-4">
              {Object.entries(job.params)
                .filter(([k, v]) => k in PARAM_LABELS && v !== null && !(k === "face" && !v) && relevant(job, k))
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{PARAM_LABELS[k]}</dt>
                    <dd>{paramValue(k, v)}</dd>
                  </div>
                ))}
              {job.result?.quality != null && job.params.mode === "target_size" && (
                <>
                  <dt className="text-slate-500">적용 품질</dt>
                  <dd>{job.result.quality}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="grid gap-2">
            {out?.file_available && (
              <a href={fileUrl(out.id, true)} className="btn-primary" download>
                결과 다운로드
              </a>
            )}
            {inp.file_available && (
              <a href={fileUrl(inp.id, true)} className="btn-secondary" download>
                원본 다운로드
              </a>
            )}
            {owner && !job.deleted_at && (
              <>
                {out?.file_available && <ContinueMenu jobs={[job]} align="left" />}
                {inp.file_available && (
                  <Link to={`${TOOL_PATHS[job.tool]}?assets=${inp.id}&from=${job.id}`} className="btn-secondary">
                    같은 설정으로 다시 하기
                  </Link>
                )}
                {(job.status === "failed" || job.status === "canceled") && inp.file_available && (
                  <button className="btn-secondary" disabled={action.isPending} onClick={() => action.mutate("retry")}>
                    재시도
                  </button>
                )}
                {job.status === "queued" && (
                  <button className="btn-secondary" disabled={action.isPending} onClick={() => action.mutate("cancel")}>
                    작업 취소
                  </button>
                )}
                {job.status !== "processing" && (
                  <button
                    className="btn-ghost text-red-600 hover:bg-red-50"
                    disabled={action.isPending}
                    onClick={() => confirm("이 작업과 파일을 삭제할까요?") && action.mutate("delete")}
                  >
                    삭제
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {(job.parent || job.children.length > 0) && (
        <section>
          <h2 className="mb-3 text-lg font-bold">작업 연결</h2>
          <div className="space-y-3">
            {job.parent && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">이전 작업 (이 작업의 입력을 만든 작업)</div>
                <JobCard job={job.parent} />
              </div>
            )}
            {job.children.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">이 결과로 이어진 작업</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {job.children.map((c) => (
                    <JobCard key={c.id} job={c} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
