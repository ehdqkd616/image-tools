import type { Job, JobStatus, Tool } from "../api/types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function formatDims(w: number | null | undefined, h: number | null | undefined): string {
  return w && h ? `${w.toLocaleString()}×${h.toLocaleString()}` : "-";
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function percentChange(before: number, after: number): number {
  if (!before) return 0;
  return Math.round(((after - before) / before) * 1000) / 10;
}

/** "-35.2%" (감소) / "+12%" (증가) */
export function formatChange(before: number, after: number): string {
  const p = percentChange(before, after);
  return `${p > 0 ? "+" : ""}${p}%`;
}

export const TOOL_LABELS: Record<Tool, string> = {
  upscale: "해상도 높이기",
  resize: "크기 조절",
  compress: "용량 줄이기",
};

export const TOOL_PATHS: Record<Tool, string> = {
  upscale: "/upscale",
  resize: "/resize",
  compress: "/compress",
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "대기 중",
  processing: "처리 중",
  done: "완료",
  failed: "실패",
  canceled: "취소됨",
};

const FIT_LABELS: Record<string, string> = { contain: "비율 유지", stretch: "늘이기", cover: "잘라서 채우기" };
const DENOISE_LABELS: Record<string, string> = { none: "없음", low: "낮음", medium: "중간", high: "높음" };
const FORMAT_LABELS: Record<string, string> = { original: "원본 형식", jpg: "JPG", png: "PNG", webp: "WebP" };

export function formatLabel(fmt: unknown): string {
  return FORMAT_LABELS[String(fmt)] ?? String(fmt ?? "").toUpperCase();
}

/** 작업 옵션 한 줄 요약 */
export function summarizeParams(tool: Tool, p: Record<string, unknown>): string {
  if (tool === "upscale") {
    return [
      `${p.scale}배`,
      p.style === "illust" ? "일러스트" : "사진",
      `노이즈 ${DENOISE_LABELS[String(p.denoise)] ?? p.denoise}`,
      formatLabel(p.format),
    ].join(" · ");
  }
  if (tool === "resize") {
    const size =
      p.mode === "percent"
        ? `${p.percent}%`
        : p.width && p.height
          ? `${p.width}×${p.height} (${FIT_LABELS[String(p.fit)] ?? p.fit})`
          : p.width
            ? `가로 ${p.width}px`
            : `세로 ${p.height}px`;
    return [size, formatLabel(p.format)].join(" · ");
  }
  const parts =
    p.mode === "target_size"
      ? [`목표 ${formatBytes(Number(p.target_bytes))}`]
      : [`품질 ${p.quality}`];
  parts.push(formatLabel(p.format));
  if (p.max_side) parts.push(`긴 변 ${p.max_side}px`);
  if (p.png_colors) parts.push(`${p.png_colors}색`);
  return parts.join(" · ");
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function isTerminal(job: Pick<Job, "status">): boolean {
  return job.status === "done" || job.status === "failed" || job.status === "canceled";
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
