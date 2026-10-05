import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError, api } from "../../api/client";
import type { User } from "../../api/types";
import { AuthLayout } from "../../components/Layout";
import { Notice, Spinner } from "../../components/ui";

const STATUS_TONE: Record<string, string> = {
  ACCOUNT_PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  ACCOUNT_REJECTED: "border-red-200 bg-red-50 text-red-700",
  ACCOUNT_SUSPENDED: "border-slate-300 bg-slate-100 text-slate-700",
};

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string; signedUp?: boolean } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api<User>("/auth/login", { method: "POST", body: { email, password } }),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      navigate(from, { replace: true });
    },
  });
  const err = login.error instanceof ApiError ? login.error : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthLayout>
      <h1 className="mb-6 text-xl font-bold">로그인</h1>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="email">
            이메일
          </label>
          <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">
            비밀번호
          </label>
          <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && (
          <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${STATUS_TONE[err.code] ?? "border-red-200 bg-red-50 text-red-700"}`}>
            <p className="font-medium">{err.message}</p>
            {typeof err.extra.reason === "string" && <p className="mt-1">사유: {err.extra.reason}</p>}
          </div>
        )}
        <button className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending && <Spinner />}
          로그인
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        계정이 없으신가요?{" "}
        <Link to="/signup" className="font-semibold text-brand-600 hover:underline">
          회원가입
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-slate-400">비밀번호를 잊으셨다면 관리자에게 임시 비밀번호를 요청하세요.</p>
    </AuthLayout>
  );
}

const PW_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", password2: "", name: "", signup_note: "", agree_terms: false, agree_privacy: false });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [localError, setLocalError] = useState<string | null>(null);

  const signup = useMutation({
    mutationFn: () =>
      api("/auth/signup", {
        method: "POST",
        body: {
          email: form.email,
          password: form.password,
          name: form.name,
          signup_note: form.signup_note || null,
          agree_terms: form.agree_terms,
          agree_privacy: form.agree_privacy,
        },
      }),
    onSuccess: () => navigate("/signup/done", { replace: true }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!PW_RULE.test(form.password)) return setLocalError("비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.");
    if (form.password !== form.password2) return setLocalError("비밀번호 확인이 일치하지 않습니다.");
    if (!form.agree_terms || !form.agree_privacy) return setLocalError("이용약관과 개인정보 처리방침에 동의해 주세요.");
    setLocalError(null);
    signup.mutate();
  };
  const error = localError ?? (signup.error instanceof Error ? signup.error.message : null);

  return (
    <AuthLayout>
      <h1 className="mb-1 text-xl font-bold">회원가입</h1>
      <p className="mb-6 text-sm text-slate-500">가입 신청 후 관리자 승인을 받으면 이용할 수 있습니다.</p>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label className="label" htmlFor="su-email">
            이메일 (아이디)
          </label>
          <input id="su-email" type="email" autoComplete="email" required className="input" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="su-pw">
            비밀번호
          </label>
          <input id="su-pw" type="password" autoComplete="new-password" required className="input" value={form.password} onChange={(e) => set({ password: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">8자 이상, 영문과 숫자를 모두 포함</p>
        </div>
        <div>
          <label className="label" htmlFor="su-pw2">
            비밀번호 확인
          </label>
          <input id="su-pw2" type="password" autoComplete="new-password" required className="input" value={form.password2} onChange={(e) => set({ password2: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="su-name">
            이름 / 닉네임
          </label>
          <input id="su-name" required maxLength={50} className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="su-note">
            가입 목적 <span className="font-normal text-slate-400">(선택)</span>
          </label>
          <textarea id="su-note" rows={3} maxLength={1000} className="input py-2" placeholder="관리자 승인에 참고합니다." value={form.signup_note} onChange={(e) => set({ signup_note: e.target.value })} />
        </div>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5 accent-brand-600" checked={form.agree_terms} onChange={(e) => set({ agree_terms: e.target.checked })} />
            <span>
              <Link to="/terms" target="_blank" className="font-medium text-brand-600 underline">
                이용약관
              </Link>
              에 동의합니다 (필수)
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5 accent-brand-600" checked={form.agree_privacy} onChange={(e) => set({ agree_privacy: e.target.checked })} />
            <span>
              <Link to="/privacy" target="_blank" className="font-medium text-brand-600 underline">
                개인정보 처리방침
              </Link>
              에 동의합니다 (필수)
            </span>
          </label>
          <p className="pl-8 text-xs text-slate-500">
            서비스 운영·문제 해결을 위해 관리자가 회원이 올린 이미지와 작업 기록을 열람할 수 있으며, 열람 기록은 모두 남습니다.
          </p>
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <button className="btn-primary w-full" disabled={signup.isPending}>
          {signup.isPending && <Spinner />}
          가입 신청
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        이미 계정이 있으신가요?{" "}
        <Link to="/login" className="font-semibold text-brand-600 hover:underline">
          로그인
        </Link>
      </p>
    </AuthLayout>
  );
}

export function SignupDonePage() {
  return (
    <AuthLayout>
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M5 12l5 5 9-10" />
          </svg>
        </div>
        <h1 className="text-xl font-bold">가입 신청이 완료되었습니다</h1>
        <p className="mt-2 text-sm text-slate-600">관리자 승인 후 로그인할 수 있습니다.</p>
        <Notice className="mt-6 text-left">승인 전에는 로그인 시 &ldquo;관리자 승인 대기 중&rdquo; 안내가 표시됩니다.</Notice>
        <Link to="/login" className="btn-primary mt-6 w-full">
          로그인 화면으로
        </Link>
      </div>
    </AuthLayout>
  );
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10">
      <article className="card mx-auto max-w-2xl space-y-4 p-6 text-sm leading-relaxed text-slate-700 sm:p-8 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900">
        <Link to="/" className="text-sm text-brand-600 hover:underline">
          ← 이미지 스튜디오
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {children}
        <p className="pt-4 text-xs text-slate-400">
          ※ 이 문서는 서비스 운영을 위한 기본 초안입니다. 공개 서비스로 운영할 경우 개인정보보호법 등 관련 법령에 맞게 전문가 검토를 받으세요.
        </p>
      </article>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="이용약관">
      <h2>제1조 (목적)</h2>
      <p>이 약관은 이미지 스튜디오(이하 &ldquo;서비스&rdquo;)가 제공하는 이미지 해상도 높이기, 크기 조절, 용량 줄이기 기능의 이용 조건을 정합니다.</p>
      <h2>제2조 (회원가입과 승인)</h2>
      <p>회원가입 신청 후 관리자가 승인한 회원만 서비스를 이용할 수 있습니다. 관리자는 가입 목적 등을 고려해 승인을 거절할 수 있습니다.</p>
      <h2>제3조 (이용자의 의무)</h2>
      <p>이용자는 본인에게 권리가 있거나 이용 허락을 받은 이미지만 올려야 하며, 타인의 권리를 침해하거나 법령에 위반되는 이미지를 올려서는 안 됩니다.</p>
      <h2>제4조 (파일 보관)</h2>
      <p>올린 이미지와 처리 결과는 정해진 보관 기간(기본 30일)이 지나면 자동으로 삭제됩니다. 작업 기록(파일 정보와 옵션)은 계속 남습니다. 회원별 저장 용량 한도를 넘으면 새 작업이 제한됩니다.</p>
      <h2>제5조 (이용 제한)</h2>
      <p>약관을 위반하거나 서비스 운영을 방해하는 경우 관리자는 이용을 정지할 수 있습니다.</p>
      <h2>제6조 (책임의 한계)</h2>
      <p>AI 처리 결과의 품질은 원본 이미지에 따라 다를 수 있으며, 서비스는 결과물의 특정 목적 적합성을 보장하지 않습니다. 중요한 원본은 별도로 보관하세요.</p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="개인정보 처리방침">
      <h2>1. 수집하는 정보</h2>
      <p>이메일, 이름(닉네임), 비밀번호(암호화 저장), 가입 목적(선택), 접속 기록(IP, 브라우저 정보, 로그인 시각), 올린 이미지와 처리 결과, 작업 기록.</p>
      <h2>2. 이용 목적</h2>
      <p>회원 식별과 가입 승인, 이미지 처리 서비스 제공, 부정 이용 방지, 문제 해결과 서비스 개선.</p>
      <h2>3. 관리자의 이미지 열람</h2>
      <p>
        <b>관리자는 서비스 운영과 문제 해결을 위해 회원이 올린 이미지, 처리 결과, 작업 기록을 열람·다운로드할 수 있습니다.</b> 관리자의 모든 열람·다운로드는 감사 로그에 기록됩니다.
      </p>
      <h2>4. 메타데이터</h2>
      <p>처리 결과 이미지에서는 기본적으로 촬영 정보·위치(GPS) 등 EXIF 메타데이터를 제거합니다. 원본 파일은 올린 그대로 보관됩니다.</p>
      <h2>5. 보관 기간</h2>
      <p>이미지 파일은 기본 30일 후 자동 삭제되며, 직접 삭제한 파일은 7일 이내에 완전히 삭제됩니다. 회원 정보와 작업 기록은 탈퇴 요청 시까지 보관합니다.</p>
      <h2>6. 문의</h2>
      <p>개인정보 관련 문의와 삭제 요청은 서비스 관리자에게 연락하세요.</p>
    </LegalPage>
  );
}
