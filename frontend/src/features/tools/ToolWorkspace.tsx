import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, api, downloadPost } from "../../api/client";
import type { Asset, Job, JobDetail, Limits, Tool } from "../../api/types";
import { useToast } from "../../components/Toast";
import { Uploader } from "../../components/Uploader";
import { ErrorBox, Notice, Spinner } from "../../components/ui";
import { useJobPolling } from "../../hooks/useJobPolling";
import { useUploads } from "../../hooks/useUploads";
import { TOOL_LABELS, isTerminal } from "../../lib/format";
import { ResultList } from "./ResultList";

export interface OptionsContext<P> {
  params: P;
  setParams: (patch: Partial<P>) => void;
  assets: Asset[];
  limits?: Limits;
}

interface Run {
  id: string;
  jobIds: string[];
}

export function ToolWorkspace<P extends object>({
  tool,
  description,
  defaultParams,
  renderOptions,
  validate,
  buildParams = (p) => p,
  restoreParams = (saved) => ({ ...defaultParams, ...(saved as P) }),
}: {
  tool: Tool;
  description: string;
  defaultParams: P;
  renderOptions: (ctx: OptionsContext<P>) => ReactNode;
  /** 실행을 막을 오류 메시지 */
  validate?: (params: P, assets: Asset[], limits?: Limits) => string | null;
  buildParams?: (params: P, assets: Asset[]) => object;
  /** "같은 설정으로 다시 하기": 저장된 작업 옵션 → 화면 상태 */
  restoreParams?: (saved: Record<string, unknown>) => P;
}) {
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const { data: limits } = useQuery({ queryKey: ["limits"], queryFn: () => api<Limits>("/limits"), staleTime: Infinity });
  const uploads = useUploads(limits);
  const [params, setParamsState] = useState<P>(defaultParams);
  const setParams = (patch: Partial<P>) => setParamsState((p) => ({ ...p, ...patch }));
  const [runs, setRuns] = useState<Run[]>([]);
  const [runError, setRunError] = useState<ApiError | null>(null);

  // 기록에서 넘어온 경우: ?assets=id,id (입력 이미지) &from=jobId (같은 설정)
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const ids = (search.get("assets") ?? "").split(",").filter(Boolean);
    const from = search.get("from");
    if (ids.length) uploads.addAssets(ids);
    if (from) {
      api<JobDetail>(`/jobs/${from}`)
        .then((job) => job.tool === tool && setParamsState(restoreParams(job.params)))
        .catch(() => {});
    }
    if (ids.length || from) setSearch({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allJobIds = useMemo(() => runs.flatMap((r) => r.jobIds), [runs]);
  const finishedRuns = useRef(new Set<string>());
  const jobs = useJobPolling(allJobIds);
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  // 한 번 실행한 묶음이 모두 끝나면 알림
  useEffect(() => {
    for (const run of runs) {
      if (finishedRuns.current.has(run.id)) continue;
      const rj = run.jobIds.map((id) => jobsById.get(id));
      if (rj.some((j) => !j || !isTerminal(j))) continue;
      finishedRuns.current.add(run.id);
      const done = rj.filter((j) => j!.status === "done").length;
      const failed = rj.filter((j) => j!.status === "failed").length;
      if (failed) toast(`${done}개 완료, ${failed}개 실패`, "error");
      else toast(`${TOOL_LABELS[tool]} ${done}개 완료!`, "success");
    }
  }, [runs, jobsById, tool, toast]);

  const assets = uploads.ready;
  const validation = assets.length ? (validate?.(params, assets, limits) ?? null) : "이미지를 먼저 올려 주세요.";

  const run = useMutation({
    mutationFn: () =>
      api<{ jobs: Job[] }>("/jobs", {
        method: "POST",
        body: { tool, params: buildParams(params, assets), asset_ids: assets.map((a) => a.id) },
      }),
    onMutate: () => setRunError(null),
    onSuccess: (res) => {
      setRuns((rs) => [{ id: crypto.randomUUID(), jobIds: res.jobs.map((j) => j.id) }, ...rs]);
      toast(`${res.jobs.length}개 작업을 시작했습니다.`, "info");
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    },
    onError: (e) => setRunError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e))),
  });

  const runButton = (
    <button
      className="btn-primary w-full text-base"
      disabled={!!validation || run.isPending || uploads.uploading}
      onClick={() => run.mutate()}
    >
      {run.isPending ? <Spinner /> : null}
      {uploads.uploading ? "업로드 중…" : assets.length > 1 ? `${assets.length}장 ${TOOL_LABELS[tool]}` : `${TOOL_LABELS[tool]} 실행`}
    </button>
  );

  const resultJobs = allJobIds.map((id) => jobsById.get(id)).filter((j): j is JobDetail => !!j);
  const doneJobs = resultJobs.filter((j) => j.status === "done" && j.output_asset?.file_available);

  return (
    <div className="pb-24 md:pb-0">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{TOOL_LABELS[tool]}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="이미지">
          <Uploader
            items={uploads.items}
            onFiles={uploads.addFiles}
            onRemove={uploads.remove}
            maxFiles={limits?.max_files_per_request ?? 20}
          />
          {uploads.items.length > 0 && (
            <div className="mt-2 flex justify-end">
              <button className="btn-ghost btn-sm" onClick={uploads.clear}>
                모두 지우기
              </button>
            </div>
          )}
        </section>

        <aside aria-label="옵션" className="lg:sticky lg:top-20 lg:self-start">
          <details className="card group" open>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 font-semibold lg:pointer-events-none">
              옵션
              <svg viewBox="0 0 20 20" className="size-5 text-slate-400 transition group-open:rotate-180 lg:hidden" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M5 8l5 5 5-5" />
              </svg>
            </summary>
            <div className="space-y-5 border-t border-slate-100 px-5 pt-4 pb-5">
              {renderOptions({ params, setParams, assets, limits })}
            </div>
          </details>
          <div className="mt-4 hidden md:block">
            {runButton}
            {validation && assets.length > 0 && <p className="mt-2 text-sm text-red-600">{validation}</p>}
          </div>
          {runError && (
            <div className="mt-3 space-y-2">
              <ErrorBox error={runError} />
              {runError.code === "IMAGE_TOO_LARGE_FOR_UPSCALE" && (
                <Link to={`/resize?assets=${assets.map((a) => a.id).join(",")}`} className="btn-secondary w-full">
                  먼저 크기 조절하기
                </Link>
              )}
              {runError.code === "QUOTA_EXCEEDED" && (
                <Link to="/history" className="btn-secondary w-full">
                  작업 기록 정리하기
                </Link>
              )}
            </div>
          )}
        </aside>
      </div>

      {resultJobs.length > 0 && (
        <section id="results" className="mt-10 scroll-mt-20" aria-label="결과">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-bold">결과</h2>
            {doneJobs.length > 1 && (
              <button
                className="btn-secondary btn-sm"
                onClick={() =>
                  downloadPost("/downloads/zip", { job_ids: doneJobs.map((j) => j.id) }, "results.zip").catch((e) =>
                    toast(e.message, "error"),
                  )
                }
              >
                전체 ZIP 다운로드 ({doneJobs.length})
              </button>
            )}
          </div>
          <Notice className="mb-4">
            페이지를 벗어나도 작업은 계속 진행되며, <Link to="/history" className="font-semibold underline">작업 기록</Link>에서
            확인할 수 있습니다.
          </Notice>
          <ResultList jobs={resultJobs} />
        </section>
      )}

      {/* 모바일 하단 고정 실행 버튼 */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:hidden">
        {validation && assets.length > 0 && <p className="mb-2 text-center text-xs text-red-600">{validation}</p>}
        {runButton}
      </div>
    </div>
  );
}
