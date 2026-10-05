import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { AdminUser, Page, UserStatus } from "../../api/types";
import { useToast } from "../../components/Toast";
import { EmptyState, ErrorBox, Modal, PageLoader, Pagination, UserStatusBadge } from "../../components/ui";
import { cx, formatBytes, formatDate } from "../../lib/format";

const TABS: { value: UserStatus | ""; label: string }[] = [
  { value: "pending", label: "승인 대기" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "거절" },
  { value: "suspended", label: "정지" },
  { value: "", label: "전체" },
];

export type UserAction = "approve" | "reject" | "suspend" | "unsuspend";

export function useUserAction(onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: UserAction; reason?: string }) =>
      api<AdminUser>(`/admin/users/${id}/${action}`, { method: "POST", body: action === "reject" ? { reason } : undefined }),
    onSuccess: (_, { action }) => {
      toast({ approve: "승인했습니다.", reject: "거절했습니다.", suspend: "정지했습니다.", unsuspend: "정지를 해제했습니다." }[action], "success");
      qc.invalidateQueries({ queryKey: ["admin"] });
      onDone?.();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "처리하지 못했습니다.", "error"),
  });
}

export function UserActions({ user, onReject }: { user: AdminUser; onReject: (u: AdminUser) => void }) {
  const act = useUserAction();
  const run = (action: UserAction, ask?: string) => (!ask || confirm(ask)) && act.mutate({ id: user.id, action });
  if (user.role === "admin") return <span className="text-xs text-slate-400">관리자</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {(user.status === "pending" || user.status === "rejected") && (
        <button className="btn-primary btn-sm" disabled={act.isPending} onClick={() => run("approve")}>
          승인
        </button>
      )}
      {user.status === "pending" && (
        <button className="btn-secondary btn-sm" disabled={act.isPending} onClick={() => onReject(user)}>
          거절
        </button>
      )}
      {user.status === "approved" && (
        <button className="btn-secondary btn-sm" disabled={act.isPending} onClick={() => run("suspend", `${user.email} 회원을 정지할까요? 즉시 로그아웃됩니다.`)}>
          정지
        </button>
      )}
      {user.status === "suspended" && (
        <button className="btn-secondary btn-sm" disabled={act.isPending} onClick={() => run("unsuspend")}>
          정지 해제
        </button>
      )}
    </div>
  );
}

export function RejectModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const act = useUserAction(() => {
    setReason("");
    onClose();
  });
  return (
    <Modal open={!!user} onClose={onClose} title="가입 거절">
      <p className="mb-3 text-sm text-slate-600">{user?.email} 회원의 가입을 거절합니다. 사유는 로그인 시 회원에게 표시됩니다.</p>
      <textarea className="input py-2" rows={3} placeholder="거절 사유 (선택)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          취소
        </button>
        <button className="btn-danger" disabled={act.isPending} onClick={() => user && act.mutate({ id: user.id, action: "reject", reason })}>
          거절
        </button>
      </div>
    </Modal>
  );
}

export function AdminUsers() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<UserStatus | "">("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<AdminUser | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", status, q, page],
    queryFn: () => api<Page<AdminUser>>("/admin/users", { query: { status, q, page, page_size: 20 } }),
  });
  const bulk = useMutation({
    mutationFn: () => api<{ approved: number }>("/admin/users/bulk-approve", { method: "POST", body: { user_ids: [...selected] } }),
    onSuccess: (r) => {
      toast(`${r.approved}명을 승인했습니다.`, "success");
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : "처리하지 못했습니다.", "error"),
  });

  const items = data?.items ?? [];
  const selectable = status === "pending";
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">회원 관리</h1>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="segmented sm:w-auto" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-pressed={status === t.value}
              onClick={() => {
                setStatus(t.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input type="search" className="input sm:ml-auto sm:max-w-xs" placeholder="이메일·이름 검색" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label="회원 검색" />
      </div>

      {selectable && items.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-brand-600" checked={selected.size === items.length} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((u) => u.id)) : new Set())} />
            전체 선택
          </label>
          <button className="btn-primary btn-sm ml-auto" disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate()}>
            선택 {selected.size}명 일괄 승인
          </button>
        </div>
      )}

      <ErrorBox error={error} />
      {isLoading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState title="해당하는 회원이 없습니다" />
      ) : (
        <>
          {/* PC: 표 */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  {selectable && <th className="w-10 p-3" />}
                  <th className="p-3">회원</th>
                  <th className="p-3">상태</th>
                  <th className="p-3">가입일</th>
                  <th className="p-3">마지막 로그인</th>
                  <th className="p-3 text-right">작업</th>
                  <th className="p-3 text-right">사용 용량</th>
                  <th className="p-3">동작</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((u) => (
                  <tr key={u.id} className={cx(selected.has(u.id) && "bg-brand-50")}>
                    {selectable && (
                      <td className="p-3">
                        <input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`${u.email} 선택`} />
                      </td>
                    )}
                    <td className="p-3">
                      <Link to={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.email}
                      </Link>
                      <div className="text-xs text-slate-500">{u.name}</div>
                      {u.signup_note && <div className="mt-1 line-clamp-2 max-w-xs text-xs text-slate-500">목적: {u.signup_note}</div>}
                    </td>
                    <td className="p-3">
                      <UserStatusBadge status={u.status} />
                    </td>
                    <td className="p-3 whitespace-nowrap text-slate-600">{formatDate(u.created_at, false)}</td>
                    <td className="p-3 whitespace-nowrap text-slate-600">{formatDate(u.last_login_at)}</td>
                    <td className="p-3 text-right tabular-nums">{u.job_count}</td>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">{formatBytes(u.storage_used_bytes)}</td>
                    <td className="p-3">
                      <UserActions user={u} onReject={setRejecting} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드 */}
          <ul className="space-y-3 md:hidden">
            {items.map((u) => (
              <li key={u.id} className={cx("card p-4", selected.has(u.id) && "ring-2 ring-brand-500")}>
                <div className="flex items-start gap-3">
                  {selectable && <input type="checkbox" className="mt-1 size-5 accent-brand-600" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`${u.email} 선택`} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/users/${u.id}`} className="truncate font-medium hover:underline">
                        {u.email}
                      </Link>
                      <UserStatusBadge status={u.status} />
                    </div>
                    <div className="text-xs text-slate-500">
                      {u.name} · 가입 {formatDate(u.created_at, false)} · 작업 {u.job_count} · {formatBytes(u.storage_used_bytes)}
                    </div>
                    {u.signup_note && <div className="mt-1 text-xs text-slate-600">목적: {u.signup_note}</div>}
                    <div className="mt-3">
                      <UserActions user={u} onReject={setRejecting} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
        </>
      )}
      <RejectModal user={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}
