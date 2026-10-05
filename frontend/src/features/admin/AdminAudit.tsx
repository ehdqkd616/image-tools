import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { AuditLog, Page } from "../../api/types";
import { EmptyState, ErrorBox, PageLoader, Pagination } from "../../components/ui";
import { formatDate } from "../../lib/format";

const ACTIONS: Record<string, string> = {
  "user.signup": "가입 신청",
  "user.password_change": "비밀번호 변경",
  "login.success": "로그인 성공",
  "login.failure": "로그인 실패",
  "login.blocked": "로그인 차단(계정 상태)",
  "admin.user.approve": "가입 승인",
  "admin.user.reject": "가입 거절",
  "admin.user.suspend": "이용 정지",
  "admin.user.unsuspend": "정지 해제",
  "admin.user.quota": "용량 한도 변경",
  "admin.user.temp_password": "임시 비밀번호 발급",
  "admin.file.view": "회원 파일 열람",
  "admin.file.download": "회원 파일 다운로드",
  "cli.admin.create": "관리자 생성(CLI)",
  "cli.admin.promote": "관리자 승격(CLI)",
};

export function describeAction(log: AuditLog): string {
  const label = ACTIONS[log.action] ?? log.action;
  const reason = typeof log.detail?.reason === "string" ? ` (사유: ${log.detail.reason})` : "";
  return label + reason;
}

const FILTERS = [
  { value: "", label: "전체" },
  { value: "admin.", label: "관리자 행동" },
  { value: "admin.file", label: "파일 열람" },
  { value: "login.", label: "로그인" },
  { value: "login.failure", label: "로그인 실패" },
];

export function AdminAudit() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", action, actor, page],
    queryFn: () => api<Page<AuditLog>>("/admin/audit-logs", { query: { action, actor, page, page_size: 50 } }),
  });
  const items = data?.items ?? [];

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">감사 로그</h1>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <select className="input sm:w-48" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} aria-label="종류">
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input type="search" className="input sm:max-w-xs" placeholder="행위자 이메일" value={actor} onChange={(e) => (setActor(e.target.value), setPage(1))} aria-label="행위자" />
      </div>
      <ErrorBox error={error} />
      {isLoading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState title="기록이 없습니다" />
      ) : (
        <>
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="p-3">일시</th>
                  <th className="p-3">행위자</th>
                  <th className="p-3">행동</th>
                  <th className="p-3">대상</th>
                  <th className="p-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((l) => (
                  <tr key={l.id}>
                    <td className="p-3 whitespace-nowrap text-slate-600 tabular-nums">{formatDate(l.created_at)}</td>
                    <td className="p-3">{l.actor_email ?? (typeof l.detail?.email === "string" ? l.detail.email : "-")}</td>
                    <td className="p-3">{describeAction(l)}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">
                      {l.target_type ? `${l.target_type}:${l.target_id?.slice(0, 8) ?? ""}` : "-"}
                    </td>
                    <td className="p-3 text-xs text-slate-500">{l.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {items.map((l) => (
              <li key={l.id} className="card p-3 text-sm">
                <div className="font-medium">{describeAction(l)}</div>
                <div className="text-xs text-slate-500">
                  {formatDate(l.created_at)} · {l.actor_email ?? (typeof l.detail?.email === "string" ? l.detail.email : "-")} · {l.ip ?? "-"}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={50} total={data?.total ?? 0} onChange={setPage} />
        </>
      )}
    </div>
  );
}
