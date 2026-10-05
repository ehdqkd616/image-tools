import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../hooks/useAuth";
import { cx } from "../lib/format";
import { IconCompress, IconHistory, IconHome, IconResize, IconUpscale, IconUser } from "./icons";
import { PageLoader } from "./ui";

const NAV = [
  { to: "/upscale", label: "해상도 높이기", short: "높이기", icon: IconUpscale },
  { to: "/resize", label: "크기 조절", short: "크기", icon: IconResize },
  { to: "/compress", label: "용량 줄이기", short: "용량", icon: IconCompress },
  { to: "/history", label: "작업 기록", short: "기록", icon: IconHistory },
];

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold text-slate-900">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span>이미지 스튜디오</span>
    </Link>
  );
}

export function AppLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Logo />
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="주 메뉴">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx(
                    "rounded-lg px-3 py-2 text-sm font-medium",
                    isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {me?.role === "admin" && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cx("rounded-lg px-3 py-2 text-sm font-medium", isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")
                }
              >
                관리자
              </NavLink>
            )}
            <NavLink
              to="/account"
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
              aria-label="내 정보"
            >
              <span className="hidden max-w-32 truncate sm:inline">{me?.name}</span>
              <IconUser className="size-5 sm:hidden" />
            </NavLink>
            <button
              className="hidden min-h-11 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100 md:block"
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/login") })}
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <Outlet />
      </main>

      {/* 모바일 하단 탭바 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="하단 메뉴"
      >
        {[{ to: "/", label: "홈", short: "홈", icon: IconHome }, ...NAV].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              cx("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-brand-600" : "text-slate-500")
            }
          >
            <n.icon className="size-6" />
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="mb-6">
        <Logo />
      </div>
      <div className="card w-full max-w-md p-6 sm:p-8">{children}</div>
      <div className="mt-6 flex gap-4 text-xs text-slate-500">
        <Link to="/terms" className="hover:underline">
          이용약관
        </Link>
        <Link to="/privacy" className="hover:underline">
          개인정보 처리방침
        </Link>
      </div>
    </div>
  );
}

/** 로그인 필요. 세션이 만료되면 로그인 화면으로 */
export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    const onExpired = () => qc.setQueryData(["me"], null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [qc]);

  if (isLoading) return <PageLoader />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && me.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <PageLoader />;
  if (me) return <Navigate to="/" replace />;
  return <Outlet />;
}
