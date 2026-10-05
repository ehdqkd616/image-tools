import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import type { Job, JobDetail } from "../api/types";
import { isTerminal } from "../lib/format";

const POLL_MS = 1500;

/** 여러 작업 상태를 끝날 때까지 폴링한다. 끝난 작업이 생기면 onFinish 호출 */
export function useJobPolling(jobIds: string[], onFinish?: (job: Job) => void) {
  const qc = useQueryClient();
  const results = useQueries({
    queries: jobIds.map((id) => ({
      queryKey: ["job", id],
      queryFn: () => api<JobDetail>(`/jobs/${id}`),
      refetchInterval: (q: { state: { data?: JobDetail } }) =>
        q.state.data && isTerminal(q.state.data) ? false : POLL_MS,
      refetchIntervalInBackground: true,
    })),
  });

  const notified = useRef(new Set<string>());
  const jobs = results.map((r) => r.data).filter((j): j is JobDetail => !!j);

  useEffect(() => {
    let changed = false;
    for (const job of jobs) {
      if (isTerminal(job) && !notified.current.has(job.id)) {
        notified.current.add(job.id);
        changed = true;
        onFinish?.(job);
      }
    }
    if (changed) {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    }
  });

  return jobs;
}
