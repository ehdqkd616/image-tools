import { JobList } from "../history/JobList";

export function AdminJobs() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">전체 작업</h1>
      <p className="mb-4 text-sm text-slate-500">모든 회원의 작업입니다. 회원이 삭제한 작업도 표시됩니다.</p>
      <JobList endpoint="/admin/jobs" selectable={false} showUser withUserFilter />
    </div>
  );
}
