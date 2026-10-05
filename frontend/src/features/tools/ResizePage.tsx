import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../api/client";
import type { Asset, Preset, ResizeParams } from "../../api/types";
import { FORMAT_OPTIONS, Field, Segmented } from "../../components/controls";
import { Notice } from "../../components/ui";
import { cx, formatDims } from "../../lib/format";
import { ToolWorkspace } from "./ToolWorkspace";

type Tab = "pixel" | "percent" | "preset";
interface ResizeUI extends ResizeParams {
  tab: Tab;
  /** 비율 잠금 시 기준이 되는 쪽 */
  driver: "width" | "height";
}

const DEFAULTS: ResizeUI = {
  tab: "pixel",
  driver: "width",
  mode: "pixel",
  width: null,
  height: null,
  percent: 50,
  lock_ratio: true,
  fit: "contain",
  format: "original",
  quality: 90,
  preset: null,
};

/** 서버(app/services/resize.py target_size)와 같은 계산 */
export function targetSize(w: number, h: number, p: ResizeParams): [number, number] | null {
  if (p.mode === "percent") {
    const r = (p.percent ?? 100) / 100;
    return [Math.max(1, Math.round(w * r)), Math.max(1, Math.round(h * r))];
  }
  if (p.width && !p.height) return [p.width, Math.max(1, Math.round((h * p.width) / w))];
  if (p.height && !p.width) return [Math.max(1, Math.round((w * p.height) / h)), p.height];
  if (!p.width || !p.height) return null;
  if (p.fit === "contain") {
    const s = Math.min(p.width / w, p.height / h);
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }
  return [p.width, p.height];
}

function toServer(p: ResizeUI): ResizeParams {
  const base = { format: p.format, quality: p.quality, lock_ratio: p.lock_ratio, preset: null, fit: p.fit, percent: null };
  if (p.tab === "percent") return { ...base, mode: "percent", percent: p.percent, width: null, height: null };
  if (p.tab === "preset") return { ...base, mode: "pixel", width: p.width, height: p.height, preset: p.preset, lock_ratio: false };
  if (p.lock_ratio) {
    return p.driver === "width"
      ? { ...base, mode: "pixel", width: p.width, height: null }
      : { ...base, mode: "pixel", width: null, height: p.height };
  }
  return { ...base, mode: "pixel", width: p.width, height: p.height };
}

function fromServer(saved: Record<string, unknown>): ResizeUI {
  const p = { ...DEFAULTS, ...(saved as Partial<ResizeParams>) } as ResizeUI;
  p.tab = p.preset ? "preset" : p.mode;
  p.driver = p.width ? "width" : "height";
  return p;
}

const pos = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : null;
};

export function ResizePage() {
  const { data: presets = [] } = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<Preset[]>("/presets/resize"),
    staleTime: Infinity,
  });

  return (
    <ToolWorkspace<ResizeUI>
      tool="resize"
      description="가로·세로 픽셀이나 비율로 크기를 바꾸고, SNS에 맞는 크기로 한 번에 맞춥니다."
      defaultParams={DEFAULTS}
      buildParams={toServer}
      restoreParams={fromServer}
      validate={(p) => {
        if (p.tab === "percent") return p.percent && p.percent > 0 ? null : "비율(%)을 입력하세요.";
        if (p.tab === "preset") return p.preset ? null : "프리셋을 선택하세요.";
        if (p.lock_ratio) return (p.driver === "width" ? p.width : p.height) ? null : "크기를 입력하세요.";
        return p.width && p.height ? null : "가로와 세로를 모두 입력하세요.";
      }}
      renderOptions={({ params: p, setParams, assets }) => {
        const ref = assets[0];
        const ratio = ref?.width && ref?.height ? ref.width / ref.height : null;
        const server = toServer(p);
        const previews = assets
          .map((a): [Asset, [number, number] | null] => [a, a.width && a.height ? targetSize(a.width, a.height, server) : null])
          .filter((x): x is [Asset, [number, number]] => !!x[1]);
        const enlarged = previews.filter(([a, [w, h]]) => w * h > (a.width ?? 0) * (a.height ?? 0));
        const showFit = (p.tab === "pixel" && !p.lock_ratio) || p.tab === "preset";

        const setWidth = (width: number | null) =>
          setParams(
            p.lock_ratio && ratio
              ? { width, height: width ? Math.max(1, Math.round(width / ratio)) : null, driver: "width" }
              : { width, driver: "width" },
          );
        const setHeight = (height: number | null) =>
          setParams(
            p.lock_ratio && ratio
              ? { height, width: height ? Math.max(1, Math.round(height * ratio)) : null, driver: "height" }
              : { height, driver: "height" },
          );

        return (
          <>
            <Segmented
              label="기준"
              value={p.tab}
              onChange={(tab) => setParams({ tab })}
              options={[
                { value: "pixel", label: "픽셀" },
                { value: "percent", label: "비율(%)" },
                { value: "preset", label: "프리셋" },
              ]}
            />

            {p.tab === "pixel" && (
              <div>
                <div className="flex items-end gap-2">
                  <Field label="가로(px)" htmlFor="rw">
                    <input id="rw" className="input" inputMode="numeric" value={p.width ?? ""} placeholder={ref?.width?.toString()} onChange={(e) => setWidth(pos(e.target.value))} />
                  </Field>
                  <button
                    type="button"
                    className={cx("mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-lg border", p.lock_ratio ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-400")}
                    aria-pressed={p.lock_ratio}
                    aria-label="비율 잠금"
                    title="원본 비율 유지"
                    onClick={() => setParams({ lock_ratio: !p.lock_ratio })}
                  >
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      {p.lock_ratio ? (
                        <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
                      ) : (
                        <path d="M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z" />
                      )}
                    </svg>
                  </button>
                  <Field label="세로(px)" htmlFor="rh">
                    <input id="rh" className="input" inputMode="numeric" value={p.height ?? ""} placeholder={ref?.height?.toString()} onChange={(e) => setHeight(pos(e.target.value))} />
                  </Field>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {p.lock_ratio
                    ? "비율 잠금: 한쪽만 입력하면 각 이미지의 원본 비율대로 나머지가 정해집니다."
                    : "가로·세로를 모두 입력하고 맞춤 방식을 고르세요."}
                </p>
              </div>
            )}

            {p.tab === "percent" && (
              <Field label={`비율: ${p.percent ?? ""}%`} htmlFor="rp">
                <input id="rp" type="range" min={5} max={400} step={5} className="w-full accent-brand-600" value={p.percent ?? 100} onChange={(e) => setParams({ percent: Number(e.target.value) })} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[25, 50, 75, 150, 200].map((v) => (
                    <button key={v} type="button" className={cx("btn-sm btn border", p.percent === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200")} onClick={() => setParams({ percent: v })}>
                      {v}%
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {p.tab === "preset" && (
              <div className="grid grid-cols-2 gap-2">
                {presets.map((ps) => (
                  <button
                    key={ps.id}
                    type="button"
                    className={cx("rounded-lg border p-2.5 text-left transition", p.preset === ps.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300")}
                    onClick={() => setParams({ preset: ps.id, width: ps.width, height: ps.height, fit: p.fit === "contain" ? "cover" : p.fit })}
                  >
                    <div className="text-sm font-medium">{ps.label}</div>
                    <div className="text-xs text-slate-500">
                      {ps.width}×{ps.height}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {showFit && (
              <Field label="맞춤 방식">
                <Segmented
                  label="맞춤 방식"
                  value={p.fit}
                  onChange={(fit) => setParams({ fit })}
                  options={[
                    { value: "contain", label: "비율 유지" },
                    { value: "cover", label: "잘라 채우기" },
                    { value: "stretch", label: "늘이기" },
                  ]}
                />
              </Field>
            )}

            <Field label="저장 형식">
              <Segmented label="저장 형식" value={p.format} onChange={(format) => setParams({ format })} options={FORMAT_OPTIONS} />
            </Field>

            {previews.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <div className="mb-1 font-semibold text-slate-700">결과 크기 미리보기</div>
                <ul className="space-y-0.5">
                  {previews.slice(0, 5).map(([a, [w, h]]) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span className="truncate">{a.original_filename}</span>
                      <span className="shrink-0">
                        {formatDims(a.width, a.height)} → <b>{formatDims(w, h)}</b>
                      </span>
                    </li>
                  ))}
                  {previews.length > 5 && <li>외 {previews.length - 5}장</li>}
                </ul>
              </div>
            )}

            {enlarged.length > 0 && (
              <Notice tone="warn">
                원본보다 크게 만들면 선명도가 떨어질 수 있습니다.{" "}
                <Link to={`/upscale?assets=${enlarged.map(([a]) => a.id).join(",")}`} className="font-semibold underline">
                  해상도 높이기
                </Link>
                를 권장합니다.
              </Notice>
            )}
          </>
        );
      }}
    />
  );
}
