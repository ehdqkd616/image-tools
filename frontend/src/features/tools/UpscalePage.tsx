import { Link } from "react-router";
import type { Asset, Limits, UpscaleParams } from "../../api/types";
import { Field, Segmented } from "../../components/controls";
import { Notice } from "../../components/ui";
import { ToolWorkspace } from "./ToolWorkspace";

const DEFAULTS: UpscaleParams = { scale: 2, style: "photo", denoise: "medium", format: "png", face: false };

function tooLarge(assets: Asset[], scale: number, limits?: Limits): Asset[] {
  if (!limits) return [];
  const maxPx = scale === 2 ? limits.upscale_max_input_pixels_2x : limits.upscale_max_input_pixels_4x;
  return assets.filter(
    (a) =>
      (a.width ?? 0) * (a.height ?? 0) > maxPx ||
      Math.max(a.width ?? 0, a.height ?? 0) * scale > limits.upscale_max_output_side,
  );
}

export function UpscalePage() {
  return (
    <ToolWorkspace<UpscaleParams>
      tool="upscale"
      description="AI로 작은 사진이나 그림을 2배·4배 크고 선명하게 만듭니다."
      defaultParams={DEFAULTS}
      validate={(p, assets, limits) =>
        tooLarge(assets, p.scale, limits).length ? `${p.scale}배 확대하기에는 너무 큰 이미지가 있습니다.` : null
      }
      renderOptions={({ params, setParams, assets, limits }) => {
        const big = tooLarge(assets, params.scale, limits);
        const maxPx = params.scale === 2 ? limits?.upscale_max_input_pixels_2x : limits?.upscale_max_input_pixels_4x;
        return (
          <>
            <Field label="배율">
              <Segmented
                label="배율"
                value={params.scale}
                onChange={(scale) => setParams({ scale })}
                options={[
                  { value: 2, label: "2배" },
                  { value: 4, label: "4배" },
                ]}
              />
            </Field>
            <Field
              label="이미지 종류"
              hint={params.style === "illust" ? "일러스트 모델은 노이즈 제거가 기본으로 포함되어 있습니다." : undefined}
            >
              <Segmented
                label="이미지 종류"
                value={params.style}
                onChange={(style) => setParams({ style })}
                options={[
                  { value: "photo", label: "사진" },
                  { value: "illust", label: "일러스트·그림" },
                ]}
              />
            </Field>
            <Field label="노이즈 제거">
              <Segmented
                label="노이즈 제거"
                value={params.denoise}
                onChange={(denoise) => setParams({ denoise })}
                options={(["none", "low", "medium", "high"] as const).map((v) => ({
                  value: v,
                  label: { none: "없음", low: "낮음", medium: "중간", high: "높음" }[v],
                  disabled: params.style === "illust",
                }))}
              />
            </Field>
            <Field label="저장 형식" hint={params.format === "jpg" ? "JPG는 품질 90으로 저장하며 투명 배경은 흰색이 됩니다." : undefined}>
              <Segmented
                label="저장 형식"
                value={params.format}
                onChange={(format) => setParams({ format })}
                options={[
                  { value: "png", label: "PNG" },
                  { value: "webp", label: "WebP" },
                  { value: "jpg", label: "JPG" },
                ]}
              />
            </Field>
            {maxPx && (
              <p className="text-xs text-slate-500">
                {params.scale}배 확대는 약 {(maxPx / 1_000_000).toLocaleString()}MP(예:{" "}
                {Math.round(Math.sqrt(maxPx))}×{Math.round(Math.sqrt(maxPx))}) 이하 이미지만 가능합니다.
              </p>
            )}
            {big.length > 0 && (
              <Notice tone="warn">
                <p>
                  {big.length}장이 너무 큽니다: {big.map((a) => a.original_filename).join(", ")}
                </p>
                <Link to={`/resize?assets=${big.map((a) => a.id).join(",")}`} className="btn-secondary btn-sm mt-2">
                  먼저 크기 조절
                </Link>
              </Notice>
            )}
          </>
        );
      }}
    />
  );
}
