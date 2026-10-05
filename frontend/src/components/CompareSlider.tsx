import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** 전/후 비교 슬라이더. 마우스·터치 드래그와 키보드(←/→) 지원 */
export function CompareSlider({
  before,
  after,
  beforeLabel = "원본",
  afterLabel = "결과",
  aspect,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** 가로/세로 비율 (결과 이미지 기준) */
  aspect?: number;
}) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    move(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
    if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
  };

  return (
    <div
      ref={box}
      className="checker relative w-full touch-none overflow-hidden rounded-xl select-none"
      style={{ aspectRatio: aspect ? String(aspect) : "4 / 3", maxHeight: "70vh" }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <img src={after} alt={afterLabel} className="absolute inset-0 size-full object-contain" draggable={false} />
      <img
        src={before}
        alt={beforeLabel}
        className="absolute inset-0 size-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
      />
      <span className="absolute top-2 left-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">{beforeLabel}</span>
      <span className="absolute top-2 right-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">{afterLabel}</span>
      <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]" style={{ left: `${pos}%` }}>
        <div
          role="slider"
          tabIndex={0}
          aria-label="비교 위치"
          aria-valuenow={Math.round(pos)}
          aria-valuemin={0}
          aria-valuemax={100}
          onKeyDown={onKey}
          className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-slate-700 shadow-lg"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
