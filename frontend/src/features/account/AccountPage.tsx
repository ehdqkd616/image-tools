import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api/client";
import { useToast } from "../../components/Toast";
import { ErrorBox, Spinner, StorageBar } from "../../components/ui";
import { useLogout, useMe } from "../../hooks/useAuth";
import { formatDate } from "../../lib/format";

export function AccountPage() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ current: "", next: "", next2: "" });
  const [localError, setLocalError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api("/auth/password", { method: "PATCH", body: { current_password: form.current, new_password: form.next } }),
    onSuccess: () => {
      setForm({ current: "", next: "", next2: "" });
      toast("비밀번호를 변경했습니다. 다른 기기에서는 로그아웃됩니다.", "success");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,128}$/.test(form.next)) return setLocalError("새 비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.");
    if (form.next !== form.next2) return setLocalError("새 비밀번호 확인이 일치하지 않습니다.");
    setLocalError(null);
    change.mutate();
  };

  if (!me) return null;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">내 정보</h1>

      <section className="card p-5">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">이메일</dt>
          <dd className="break-all">{me.email}</dd>
          <dt className="text-slate-500">이름</dt>
          <dd>{me.name}</dd>
          <dt className="text-slate-500">가입일</dt>
          <dd>{formatDate(me.created_at, false)}</dd>
          <dt className="text-slate-500">권한</dt>
          <dd>{me.role === "admin" ? "관리자" : "일반 회원"}</dd>
        </dl>
        <div className="mt-5">
          <StorageBar used={me.storage_used_bytes} quota={me.storage_quota_bytes} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-bold">비밀번호 변경</h2>
        <form className="space-y-3" onSubmit={submit}>
          <input type="password" className="input" placeholder="현재 비밀번호" autoComplete="current-password" aria-label="현재 비밀번호" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
          <input type="password" className="input" placeholder="새 비밀번호 (8자 이상, 영문+숫자)" autoComplete="new-password" aria-label="새 비밀번호" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required />
          <input type="password" className="input" placeholder="새 비밀번호 확인" autoComplete="new-password" aria-label="새 비밀번호 확인" value={form.next2} onChange={(e) => setForm({ ...form, next2: e.target.value })} required />
          <ErrorBox error={localError ?? change.error} />
          <button className="btn-primary w-full sm:w-auto" disabled={change.isPending}>
            {change.isPending && <Spinner />}
            변경
          </button>
        </form>
      </section>

      <button className="btn-secondary w-full" onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/login") })}>
        로그아웃
      </button>
    </div>
  );
}
