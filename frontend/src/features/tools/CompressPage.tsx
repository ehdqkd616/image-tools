import { useEffect, useRef, useState } from "react";
import { fileUrl } from "../../api/client";
import type { Asset, CompressParams } from "../../api/types";
import { FORMAT_OPTIONS, Field, Segmented, Toggle } from "../../components/controls";
import { Notice } from "../../components/ui";
import { formatBytes, formatChange } from "../../lib/format";
import { ToolWorkspace } from "./ToolWorkspace";

interface CompressUI extends CompressParams {
  target_value: number;
  target_unit: "KB" | "MB";
  limit_side: boolean;
}

const DEFAULTS: CompressUI = {
  mode: "quality",
  quality: 75,
  target_bytes: null,
  target_value: 500,
  target_unit: "KB",
  format: "original",
  max_side: null,
  limit_side: false,
  strip_metadata: true,
  png_colors: 0,
  allow_downscale: true,
};

const toBytes = (p: CompressUI) => Math.round(p.target_value * (p.target_unit === "MB" ? 1024 * 1024 : 1024));

function toServer(p: CompressUI): CompressParams {
  return {
    mode: p.mode,
    quality: p.quality,
    target_bytes: p.mode === "target_size" ? toBytes(p) : null,
    format: p.format,
    max_side: p.limit_side ? p.max_side : null,
    strip_metadata: p.strip_metadata,
    png_colors: p.png_colors,
    allow_downscale: p.allow_downscale,
  };
}

function fromServer(saved: Record<string, unknown>): CompressUI {
  const p = { ...DEFAULTS, ...(saved as Partial<CompressParams>) } as CompressUI;
  if (p.target_bytes) {
    const mb = p.target_bytes >= 1024 * 1024;
    p.target_unit = mb ? "MB" : "KB";
    p.target_value = Math.round((p.target_bytes / (mb ? 1024 * 1024 : 1024)) * 100) / 100;
  }
  p.limit_side = !!p.max_side;
  return p;
}

const outFormat = (p: CompressUI, a: Asset | undefined) =>
  p.format !== "original" ? p.format : a?.format === "heif" ? "jpg" : ["jpg", "png", "webp"].includes(a?.format ?? "") ? a!.format! : "png";

/** [선택] 품질 슬라이더 실시간 예상 용량 (브라우저 canvas 인코딩 근사치) */
function useEstimate(asset: Asset | undefined, fmt: string, quality: number, enabled: boolean) {
  const [estimate, setEstimate] = useState<number | null>(null);
  const bitmap = useRef<{ id: string; canvas: HTMLCanvasElement } | null>(null);

  useEffect(() => {
    if (!enabled || !asset || !asset.file_available || (fmt !== "jpg" && fmt !== "webp")) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (bitmap.current?.id !== asset.id) {
          const blob = await (await fetch(fileUrl(asset.id))).blob();
          const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
          const canvas = document.createElement("canvas");
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext("2d")!;
          if (fmt === "jpg") {
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(bmp, 0, 0);
          bitmap.current = { id: asset.id, canvas };
        }
        const type = fmt === "jpg" ? "image/jpeg" : "image/webp";
        bitmap.current.canvas.toBlob((b) => !cancelled && setEstimate(b?.size ?? null), type, quality / 100);
      } catch {
        if (!cancelled) setEstimate(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [asset, fmt, quality, enabled]);
  return estimate;
}

function Estimate({ asset, p }: { asset: Asset | undefined; p: CompressUI }) {
  const fmt = outFormat(p, asset);
  const est = useEstimate(asset, fmt, p.quality, p.mode === "quality" && !p.limit_side);
  if (est == null || !asset) return null;
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      첫 번째 이미지 예상 용량: <b className="text-slate-800">약 {formatBytes(est)}</b> ({formatChange(asset.size_bytes, est)}){" "}
      <span className="text-slate-400">· 브라우저 계산 예상값</span>
    </div>
  );
}

export function CompressPage() {
  return (
    <ToolWorkspace<CompressUI>
      tool="compress"
      description="화질을 조절하거나 목표 용량을 정해 사진 파일 크기를 줄입니다."
      defaultParams={DEFAULTS}
      buildParams={toServer}
      restoreParams={fromServer}
      validate={(p) => {
        if (p.mode === "target_size" && !(toBytes(p) >= 1024)) return "목표 용량은 1KB 이상이어야 합니다.";
        if (p.limit_side && !(p.max_side && p.max_side >= 16)) return "긴 변 최대 크기를 입력하세요.";
        return null;
      }}
      renderOptions={({ params: p, setParams, assets }) => {
        const pngOut = assets.some((a) => outFormat(p, a) === "png");
        return (
          <>
            <Segmented
              label="방식"
              value={p.mode}
              onChange={(mode) => setParams({ mode })}
              options={[
                { value: "quality", label: "품질 직접 조절" },
                { value: "target_size", label: "목표 용량 맞춤" },
              ]}
            />

            {p.mode === "quality" ? (
              <Field label={`품질: ${p.quality}`} htmlFor="cq" hint="낮을수록 용량이 작아지고 화질이 떨어집니다. 보통 60~80을 권장합니다.">
                <input id="cq" type="range" min={1} max={100} className="w-full accent-brand-600" value={p.quality} onChange={(e) => setParams({ quality: Number(e.target.value) })} />
              </Field>
            ) : (
              <Field label="목표 용량 (이하)" htmlFor="ct">
                <div className="flex gap-2">
                  <input
                    id="ct"
                    className="input"
                    inputMode="decimal"
                    value={p.target_value || ""}
                    onChange={(e) => setParams({ target_value: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) })}
                  />
                  <select className="input w-24" value={p.target_unit} onChange={(e) => setParams({ target_unit: e.target.value as "KB" | "MB" })} aria-label="단위">
                    <option>KB</option>
                    <option>MB</option>
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    [100, "KB"],
                    [300, "KB"],
                    [500, "KB"],
                    [1, "MB"],
                    [2, "MB"],
                  ].map(([v, u]) => (
                    <button key={`${v}${u}`} type="button" className="btn-sm btn border border-slate-200" onClick={() => setParams({ target_value: v as number, target_unit: u as "KB" | "MB" })}>
                      {v}
                      {u}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="저장 형식">
              <Segmented label="저장 형식" value={p.format} onChange={(format) => setParams({ format })} options={FORMAT_OPTIONS} />
            </Field>

            {pngOut && (
              <>
                <Notice tone="warn">PNG는 품질 개념이 없어 줄어드는 정도가 이미지마다 다릅니다. 색상 수를 줄이면 더 작아집니다.</Notice>
                {p.mode === "quality" && (
                  <Field label="PNG 색상 수">
                    <select className="input" value={p.png_colors} onChange={(e) => setParams({ png_colors: Number(e.target.value) as CompressParams["png_colors"] })}>
                      <option value={0}>줄이지 않음 (무손실)</option>
                      <option value={256}>256색</option>
                      <option value={128}>128색</option>
                      <option value={64}>64색</option>
                      <option value={32}>32색</option>
                    </select>
                  </Field>
                )}
              </>
            )}

            <div className="space-y-1">
              <Toggle checked={p.limit_side} onChange={(limit_side) => setParams({ limit_side, max_side: p.max_side ?? 1920 })} label="크기도 함께 줄이기" hint="긴 변을 지정한 픽셀 이하로 줄입니다." />
              {p.limit_side && (
                <input className="input" inputMode="numeric" aria-label="긴 변 최대 픽셀" value={p.max_side ?? ""} onChange={(e) => setParams({ max_side: parseInt(e.target.value, 10) || null })} />
              )}
              {p.mode === "target_size" && (
                <Toggle checked={p.allow_downscale} onChange={(allow_downscale) => setParams({ allow_downscale })} label="필요하면 해상도 줄이기" hint="최저 품질로도 목표에 못 미치면 크기를 단계적으로 줄입니다." />
              )}
              <Toggle checked={p.strip_metadata} onChange={(strip_metadata) => setParams({ strip_metadata })} label="메타데이터 제거" hint="촬영 정보·위치(GPS) 등 EXIF 정보를 지웁니다." />
            </div>

            <Estimate asset={assets[0]} p={p} />
          </>
        );
      }}
    />
  );
}
