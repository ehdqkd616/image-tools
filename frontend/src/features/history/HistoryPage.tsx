import { StorageBar } from "../../components/ui";
import { useMe } from "../../hooks/useAuth";
import { JobList } from "./JobList";

export function HistoryPage() {
  const { data: me } = useMe();
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">작업 기록</h1>
          <p className="mt-1 text-sm text-slate-500">파일은 일정 기간 후 자동 삭제되며, 기록은 계속 남습니다.</p>
        </div>
        {me && (
          <div className="w-full sm:w-72">
            <StorageBar used={me.storage_used_bytes} quota={me.storage_quota_bytes} />
          </div>
        )}
      </div>
      <JobList endpoint="/jobs" />
    </div>
  );
}
