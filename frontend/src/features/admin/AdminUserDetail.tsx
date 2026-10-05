import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../../api/client";
import type { AdminUser, AuditLog } from "../../api/types";
import { useToast } from "../../components/Toast";
import { ErrorBox, Modal, PageLoader, StorageBar, UserStatusBadge } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { JobList } from "../history/JobList";
import { RejectModal, UserActions } from "./AdminUsers";
import { describeAction } from "./AdminAudit";

export function AdminUserDetail() {
  const { userId = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<AdminUser | null>(null);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaMb, setQuotaMb] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => api<{ user: AdminUser; history: AuditLog[] }>(`/admin/users/${userId}`),
  });

  const issueTemp = useMutation({
    mutationFn: () => api<{ temp_password: string }>(`/admin/users/${userId}/temp-password`, { method: "POST" }),
    onSuccess: (r) => {
      setTempPw(r.temp_password);
      qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "발급하지 못했습니다.", "error"),
  });
  const setQuota = useMutation({
    mutationFn: () => api(`/admin/users/${userId}/quota`, { method: "PATCH", body: { quota_mb: Number(quotaMb) } }),
    onSuccess: () => {
      toast("저장 용량 한도를 변경했습니다.", "success");
      setQuotaOpen(false);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "변경하지 못했습니다.", "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorBox error={error} />;
  const { user, history } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/users" className="text-sm text-slate-500 hover:text-slate-800">
          ← 회원 목록
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold break-all">{user.email}</h1>
          <UserStatusBadge status={user.status} />
          {user.role === "admin" && <span className="badge bg-slate-900 text-white">관리자</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">이름</dt>
            <dd>{user.name}</dd>
            <dt className="text-slate-500">가입일</dt>
            <dd>{formatDate(user.created_at)}</dd>
            <dt className="text-slate-500">승인일</dt>
            <dd>{formatDate(user.approved_at)}</dd>
            <dt className="text-slate-500">마지막 로그인</dt>
            <dd>{formatDate(user.last_login_at)}</dd>
            <dt className="text-slate-500">작업 수</dt>
            <dd>{user.job_count}</dd>
            <dt className="text-slate-500">가입 목적</dt>
            <dd className="whitespace-pre-wrap">{user.signup_note ?? "-"}</dd>
            {user.reject_reason && (
              <>
                <dt className="text-slate-500">거절 사유</dt>
                <dd>{user.reject_reason}</dd>
              </>
            )}
          </dl>
          <StorageBar used={user.storage_used_bytes} quota={user.storage_quota_bytes} />
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <UserActions user={user} onReject={setRejecting} />
            <button
              className="btn-secondary btn-sm"
              onClick={() => {
                setQuotaMb(String(Math.round(user.storage_quota_bytes / 1024 / 1024)));
                setQuotaOpen(true);
              }}
            >
              용량 한도 변경
            </button>
            {user.role !== "admin" && (
              <button
                className="btn-secondary btn-sm"
                disabled={issueTemp.isPending}
                onClick={() => confirm("임시 비밀번호를 발급할까요? 기존 비밀번호와 로그인 세션이 모두 무효화됩니다.") && issueTemp.mutate()}
              >
                임시 비밀번호 발급
              </button>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-bold">상태 변경 이력</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">이력이 없습니다.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className="shrink-0 text-xs whitespace-nowrap text-slate-400 tabular-nums">{formatDate(h.created_at)}</span>
                  <span>
                    {describeAction(h)}
                    {h.actor_email && h.action !== "user.signup" && <span className="text-slate-400"> · {h.actor_email}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">작업 기록</h2>
        <JobList endpoint={`/admin/users/${userId}/jobs`} selectable={false} />
      </section>

      <RejectModal user={rejecting} onClose={() => setRejecting(null)} />
      <Modal open={!!tempPw} onClose={() => setTempPw(null)} title="임시 비밀번호">
        <p className="mb-3 text-sm text-slate-600">이 화면을 닫으면 다시 볼 수 없습니다. 회원에게 안전하게 전달하고, 로그인 후 바로 변경하도록 안내하세요.</p>
        <code className="block rounded-lg bg-slate-100 p-3 text-center font-mono text-lg tracking-wider select-all">{tempPw}</code>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={() => setTempPw(null)}>
            확인
          </button>
        </div>
      </Modal>
      <Modal open={quotaOpen} onClose={() => setQuotaOpen(false)} title="저장 용량 한도">
        <label className="label" htmlFor="quota">
          한도 (MB)
        </label>
        <input id="quota" className="input" inputMode="numeric" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value.replace(/\D/g, ""))} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setQuotaOpen(false)}>
            취소
          </button>
          <button className="btn-primary" disabled={!quotaMb || setQuota.isPending} onClick={() => setQuota.mutate()}>
            저장
          </button>
        </div>
      </Modal>
    </div>
  );
}
