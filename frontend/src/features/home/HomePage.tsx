import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { Job, Page } from "../../api/types";
import { JobCard } from "../../components/JobCard";
import { IconCompress, IconResize, IconUpscale } from "../../components/icons";
import { EmptyState, StorageBar } from "../../components/ui";
import { useMe } from "../../hooks/useAuth";

const TOOLS = [
  {
    to: "/upscale",
    title: "해상도 높이기",
    desc: "AI로 작은 이미지를 2배·4배 선명하게",
    icon: IconUpscale,
    color: "bg-violet-50 text-violet-600",
  },
  {
    to: "/resize",
    title: "크기 조절",
    desc: "픽셀·비율·SNS 프리셋으로 크기 변경",
    icon: IconResize,
    color: "bg-sky-50 text-sky-600",
  },
  {
    to: "/compress",
    title: "용량 줄이기",
    desc: "품질 조절이나 목표 용량으로 압축",
    icon: IconCompress,
    color: "bg-emerald-50 text-emerald-600",
  },
];

export function HomePage() {
  const { data: me } = useMe();
  const { data: recent } = useQuery({
    queryKey: ["jobs", "recent"],
    queryFn: () => api<Page<Job>>("/jobs", { query: { page_size: 5 } }),
  });

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">안녕하세요, {me?.name}님</h1>
        <p className="mt-1 text-sm text-slate-500">어떤 작업을 할까요?</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {TOOLS.map((t) => (
            <Link key={t.to} to={t.to} className="card group flex items-center gap-4 p-5 transition hover:border-brand-500 hover:shadow-md sm:flex-col sm:items-start">
              <div className={`flex size-12 items-center justify-center rounded-xl ${t.color}`}>
                <t.icon className="size-6" />
              </div>
              <div>
                <div className="font-semibold group-hover:text-brand-700">{t.title}</div>
                <div className="mt-0.5 text-sm text-slate-500">{t.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-bold">최근 작업</h2>
          <Link to="/history" className="text-sm font-medium text-brand-600 hover:underline">
            전체 보기
          </Link>
        </div>
        {recent && recent.items.length === 0 ? (
          <EmptyState title="아직 작업이 없습니다">위에서 기능을 골라 첫 작업을 시작해 보세요.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recent?.items.map((j) => <JobCard key={j.id} job={j} />)}
          </div>
        )}
      </section>

      {me && (
        <section className="card max-w-md p-5">
          <StorageBar used={me.storage_used_bytes} quota={me.storage_quota_bytes} />
        </section>
      )}
    </div>
  );
}
