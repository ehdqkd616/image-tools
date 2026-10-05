import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, downloadPost } from "../../api/client";
import type { Job, Page } from "../../api/types";
import { ContinueMenu, JobCard } from "../../components/JobCard";
import { useToast } from "../../components/Toast";
import { EmptyState, ErrorBox, InfiniteTrigger, Pagination, PageLoader, Spinner } from "../../components/ui";
import { useIsDesktop } from "../../hooks/useMediaQuery";
import { STATUS_LABELS, TOOL_LABELS, isTerminal } from "../../lib/format";

export interface JobFilters {
  tool: string;
  status: string;
  date_from: string;
  date_to: string;
  q: string;
  user?: string;
}

const EMPTY: JobFilters = { tool: "", status: "", date_from: "", date_to: "", q: "" };
const PAGE_SIZE = 20;

function Filters({ value, onChange, withUser }: { value: JobFilters; onChange: (f: JobFilters) => void; withUser?: boolean }) {
  const set = (patch: Partial<JobFilters>) => onChange({ ...value, ...patch });
  return (
    <div className="card mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_1.5fr]">
      <select className="input" value={value.tool} onChange={(e) => set({ tool: e.target.value })} aria-label="기능">
        <option value="">전체 기능</option>
        {Object.entries(TOOL_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select className="input" value={value.status} onChange={(e) => set({ status: e.target.value })} aria-label="상태">
        <option value="">전체 상태</option>
        {Object.entries(STATUS_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
        <option value="expired">파일 만료</option>
      </select>
      <input type="date" className="input" value={value.date_from} onChange={(e) => set({ date_from: e.target.value })} aria-label="시작일" />
      <input type="date" className="input" value={value.date_to} onChange={(e) => set({ date_to: e.target.value })} aria-label="종료일" />
      <input
        type="search"
        className="input col-span-2 md:col-span-1"
        placeholder={withUser ? "회원 이메일·이름" : "파일명 검색"}
        value={withUser ? (value.user ?? "") : value.q}
        onChange={(e) => set(withUser ? { user: e.target.value } : { q: e.target.value })}
        aria-label="검색"
      />
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

/** 작업 목록: PC는 페이지 번호, 모바일은 무한 스크롤 */
export function JobList({
  endpoint,
  selectable = true,
  showUser = false,
  withUserFilter = false,
}: {
  endpoint: string;
  selectable?: boolean;
  showUser?: boolean;
  withUserFilter?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const qc = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState<JobFilters>(EMPTY);
  const debounced = useDebounced(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const query = { ...debounced, page_size: PAGE_SIZE };

  const paged = useQuery({
    queryKey: ["jobs", endpoint, "page", debounced, page],
    queryFn: () => api<Page<Job>>(endpoint, { query: { ...query, page } }),
    enabled: isDesktop,
    refetchInterval: (q) => (q.state.data?.items.some((j) => !isTerminal(j)) ? 2000 : false),
  });
  const infinite = useInfiniteQuery({
    queryKey: ["jobs", endpoint, "infinite", debounced],
    queryFn: ({ pageParam }) => api<Page<Job>>(endpoint, { query: { ...query, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: !isDesktop,
  });

  const items = isDesktop ? (paged.data?.items ?? []) : (infinite.data?.pages.flatMap((p) => p.items) ?? []);
  const total = isDesktop ? (paged.data?.total ?? 0) : (infinite.data?.pages[0]?.total ?? 0);
  const loading = isDesktop ? paged.isLoading : infinite.isLoading;
  const error = isDesktop ? paged.error : infinite.error;
  const selectedJobs = items.filter((j) => selected.has(j.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const changeFilters = (f: JobFilters) => {
    setFilters(f);
    setPage(1);
    setSelected(new Set());
  };

  const downloadZip = async (includeOriginal: boolean) => {
    setBusy(true);
    try {
      await downloadPost("/downloads/zip", { job_ids: [...selected], include_original: includeOriginal }, "images.zip");
    } catch (e) {
      toast(e instanceof Error ? e.message : "다운로드하지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!confirm(`선택한 ${selected.size}개 작업과 파일을 삭제할까요?`)) return;
    setBusy(true);
    const results = await Promise.allSettled([...selected].map((id) => api(`/jobs/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected").length;
    toast(failed ? `${failed}개는 삭제하지 못했습니다 (처리 중인 작업 등).` : "삭제했습니다.", failed ? "error" : "success");
    setSelected(new Set());
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <div>
      <Filters value={filters} onChange={changeFilters} withUser={withUserFilter} />

      {selectable && selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 p-2 pl-4 text-sm text-white shadow-lg">
          <span className="mr-auto font-medium">{selected.size}개 선택</span>
          {busy && <Spinner className="size-4" />}
          <button className="btn-sm btn bg-white/10 hover:bg-white/20" disabled={busy} onClick={() => downloadZip(false)}>
            ZIP 다운로드
          </button>
          <button className="btn-sm btn bg-white/10 hover:bg-white/20" disabled={busy} onClick={() => downloadZip(true)}>
            원본 포함 ZIP
          </button>
          <ContinueMenu jobs={selectedJobs} className="[&>button]:btn-sm [&>button]:border-0 [&>button]:bg-white/10 [&>button]:text-white" />
          <button className="btn-sm btn bg-red-500 hover:bg-red-600" disabled={busy} onClick={deleteSelected}>
            삭제
          </button>
          <button className="btn-sm btn hover:bg-white/10" onClick={() => setSelected(new Set())} aria-label="선택 해제">
            ✕
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between text-sm text-slate-500">
        <span>총 {total.toLocaleString()}건</span>
        {selectable && items.length > 0 && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => setSelected(selectedJobs.length === items.length ? new Set() : new Set(items.map((j) => j.id)))}
          >
            {selectedJobs.length === items.length ? "선택 해제" : "현재 목록 전체 선택"}
          </button>
        )}
      </div>

      <ErrorBox error={error} className="mb-3" />
      {loading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState title="작업 기록이 없습니다">조건을 바꾸거나 새 작업을 시작해 보세요.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((j) => (
            <JobCard key={j.id} job={j} showUser={showUser} selected={selected.has(j.id)} onSelect={selectable ? (on) => toggle(j.id, on) : undefined} />
          ))}
        </div>
      )}

      {isDesktop ? (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      ) : (
        <>
          <InfiniteTrigger onVisible={() => infinite.fetchNextPage()} disabled={!infinite.hasNextPage || infinite.isFetchingNextPage} />
          {infinite.isFetchingNextPage && <PageLoader />}
        </>
      )}
    </div>
  );
}
