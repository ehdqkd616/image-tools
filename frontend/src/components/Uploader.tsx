import { useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import type { UploadItem } from "../hooks/useUploads";
import { cx, formatBytes, formatDims } from "../lib/format";
import { ProgressBar } from "./ui";

export function Uploader({
  items,
  onFiles,
  onRemove,
  maxFiles,
  disabled,
}: {
  items: UploadItem[];
  onFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  maxFiles: number;
  disabled?: boolean;
}) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (accepted) => accepted.length && onFiles(accepted),
    // 와일드카드 MIME에 확장자를 붙이면 react-dropzone이 와일드카드를 빼버리므로 키를 나눈다
    accept: { "image/*": [], "image/heic": [".heic"], "image/heif": [".heif"] },
    multiple: true,
    noClick: true,
    noKeyboard: true,
    // 붙여넣기는 아래 window 리스너가 처리 (포커스 없이도 동작)
    noPaste: true,
    disabled,
  });

  // PC: 클립보드 이미지 붙여넣기
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        onFiles(
          files.map((f) =>
            f.name && f.name !== "image.png"
              ? f
              : new File([f], `붙여넣은 이미지_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${f.type.split("/")[1] ?? "png"}`, { type: f.type }),
          ),
        );
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFiles, disabled]);

  // 모바일: 카메라 바로 촬영 (Android 13+ 사진 선택기에는 카메라가 없으므로 별도 버튼)
  const camera = useRef<HTMLInputElement>(null);
  const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const cameraInput = (
    <input
      ref={camera}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length) onFiles(files);
        e.target.value = "";
      }}
    />
  );

  const hasItems = items.length > 0;
  return (
    <div
      {...getRootProps()}
      className={cx(
        "card relative border-2 border-dashed p-4 transition",
        isDragActive ? "border-brand-500 bg-brand-50" : "border-slate-200",
      )}
    >
      <input {...getInputProps()} aria-label="이미지 파일 선택" />
      {cameraInput}
      {!hasItems ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center sm:py-14">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
            </svg>
          </div>
          <button type="button" className="btn-primary w-full max-w-xs text-base sm:w-auto" onClick={open} disabled={disabled}>
            사진 선택
          </button>
          {isTouch && (
            <button type="button" className="btn-secondary w-full max-w-xs" onClick={() => camera.current?.click()} disabled={disabled}>
              카메라로 촬영
            </button>
          )}
          <p className="hidden text-sm text-slate-500 md:block">
            또는 이미지를 여기로 끌어다 놓거나 <kbd className="rounded border bg-slate-50 px-1">Ctrl</kbd>+
            <kbd className="rounded border bg-slate-50 px-1">V</kbd>로 붙여넣으세요
          </p>
          <p className="text-xs text-slate-400">JPG · PNG · WebP · GIF · BMP · TIFF · HEIC / 한 번에 최대 {maxFiles}장</p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <li key={it.key} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="checker aspect-square">
                  {it.preview ? (
                    <img src={it.preview} alt={it.name} className="size-full object-contain" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-xs text-slate-400">미리보기 없음</div>
                  )}
                </div>
                <div className="space-y-1 p-2">
                  <div className="truncate text-xs font-medium text-slate-800" title={it.name}>
                    {it.name}
                  </div>
                  {it.status === "ready" && it.asset && (
                    <div className="text-[11px] text-slate-500">
                      {formatDims(it.asset.width, it.asset.height)} · {formatBytes(it.asset.size_bytes)}
                    </div>
                  )}
                  {(it.status === "uploading" || it.status === "waiting") && (
                    <>
                      <ProgressBar value={it.progress} />
                      <div className="text-[11px] text-slate-500">
                        {it.status === "waiting" ? "대기 중" : `업로드 ${it.progress}%`}
                      </div>
                    </>
                  )}
                  {it.status === "error" && <div className="text-[11px] leading-snug text-red-600">{it.error}</div>}
                </div>
                <button
                  type="button"
                  className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900/80"
                  onClick={() => onRemove(it.key)}
                  aria-label={`${it.name} 제거`}
                >
                  <svg viewBox="0 0 20 20" className="size-4" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </li>
            ))}
            {items.length < maxFiles && (
              <li>
                <button
                  type="button"
                  onClick={open}
                  disabled={disabled}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600"
                >
                  <span className="text-2xl leading-none">+</span>
                  사진 추가
                </button>
              </li>
            )}
          </ul>
          {isDragActive && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-brand-50/90 text-sm font-semibold text-brand-700">
              여기에 놓으세요
            </div>
          )}
        </>
      )}
    </div>
  );
}
