import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { api } from "../../api/client";
import type { AdminStats } from "../../api/types";
import { cx } from "../../lib/format";

export function useAdminStats() {
  return useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<AdminStats>("/admin/stats"), refetchInterval: 30_000 });
}

export function AdminLayout() {
  const { data: stats } = useAdminStats();
  const tabs = [
    { to: "/admin", label: "대시보드", end: true },
    { to: "/admin/users", label: "회원 관리", badge: stats?.pending_users },
    { to: "/admin/jobs", label: "전체 작업" },
    { to: "/admin/audit", label: "감사 로그" },
  ];
  return (
    <div>
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-4" aria-label="관리자 메뉴">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx(
                "-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                isActive ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )
            }
          >
            {t.label}
            {!!t.badge && <span className="badge bg-red-500 text-white">{t.badge}</span>}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
