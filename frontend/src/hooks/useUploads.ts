import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, thumbUrl, uploadFile } from "../api/client";
import type { Asset, Limits } from "../api/types";

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  preview: string | null;
  status: "waiting" | "uploading" | "ready" | "error";
  progress: number;
  asset?: Asset;
  error?: string;
}

const CONCURRENCY = 3;
let seq = 0;

export function useUploads(limits: Limits | undefined) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const active = useRef(0);
  const queue = useRef<string[]>([]);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }, []);

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length) {
      const key = queue.current.shift()!;
      const file = files.current.get(key);
      if (!file) continue;
      active.current++;
      const ctrl = new AbortController();
      controllers.current.set(key, ctrl);
      update(key, { status: "uploading", progress: 0 });
      uploadFile(file, (p) => update(key, { progress: Math.round(p * 100) }), ctrl.signal)
        .then((asset) => update(key, { status: "ready", progress: 100, asset }))
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === "ABORTED") return;
          update(key, { status: "error", error: e instanceof Error ? e.message : "업로드하지 못했습니다." });
        })
        .finally(() => {
          active.current--;
          controllers.current.delete(key);
          files.current.delete(key);
          pump();
        });
    }
  }, [update]);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const addFiles = useCallback(
    (list: File[]) => {
      const maxFiles = limits?.max_files_per_request ?? 20;
      const maxBytes = (limits?.max_upload_mb ?? 20) * 1024 * 1024;
      const room = Math.max(0, maxFiles - itemsRef.current.length);
      const added: UploadItem[] = list.slice(0, room).map((file) => {
        const key = `u${++seq}`;
        const tooBig = file.size > maxBytes;
        if (!tooBig) {
          files.current.set(key, file);
          queue.current.push(key);
        }
        return {
          key,
          name: file.name || "붙여넣은 이미지",
          size: file.size,
          preview: file.type.startsWith("image/") && !/hei[cf]/.test(file.type) ? URL.createObjectURL(file) : null,
          status: tooBig ? "error" : "waiting",
          progress: 0,
          error: tooBig ? `파일당 최대 ${limits?.max_upload_mb ?? 20}MB까지 올릴 수 있습니다.` : undefined,
        };
      });
      const skipped = list.length - added.length;
      if (skipped > 0) {
        added.push({
          key: `u${++seq}`,
          name: `${skipped}개 파일`,
          size: 0,
          preview: null,
          status: "error",
          progress: 0,
          error: `한 번에 최대 ${maxFiles}장까지 처리할 수 있습니다.`,
        });
      }
      itemsRef.current = [...itemsRef.current, ...added];
      setItems((current) => [...current, ...added]);
      setTimeout(pump, 0);
    },
    [limits, pump],
  );

  /** 기록에서 넘어온 기존 에셋을 입력으로 추가 */
  const addAssets = useCallback(async (ids: string[]) => {
    const loaded = await Promise.all(
      ids.map((id) => api<Asset>(`/assets/${id}`).catch((e: unknown) => ({ id, error: e as Error }))),
    );
    setItems((current) => [
      ...current,
      ...loaded.map((a): UploadItem => {
        if ("error" in a) {
          return { key: `a${++seq}`, name: "이미지", size: 0, preview: null, status: "error", progress: 0, error: a.error.message };
        }
        return {
          key: `a${++seq}`,
          name: a.original_filename ?? "이미지",
          size: a.size_bytes,
          preview: a.file_available ? thumbUrl(a.id) : null,
          status: a.file_available ? "ready" : "error",
          progress: 100,
          asset: a,
          error: a.file_available ? undefined : "파일이 만료되었거나 삭제되었습니다.",
        };
      }),
    ]);
  }, []);

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    files.current.delete(key);
    queue.current = queue.current.filter((k) => k !== key);
    const it = itemsRef.current.find((x) => x.key === key);
    if (it?.preview?.startsWith("blob:")) URL.revokeObjectURL(it.preview);
    setItems((xs) => xs.filter((x) => x.key !== key));
  }, []);

  const clear = useCallback(() => {
    for (const c of controllers.current.values()) c.abort();
    files.current.clear();
    queue.current = [];
    for (const x of itemsRef.current) if (x.preview?.startsWith("blob:")) URL.revokeObjectURL(x.preview);
    setItems([]);
  }, []);

  // 페이지를 벗어날 때 업로드 중이면 확인
  const uploading = items.some((x) => x.status === "uploading" || x.status === "waiting");
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const ready = items.filter((x) => x.status === "ready" && x.asset).map((x) => x.asset!);
  return { items, ready, uploading, addFiles, addAssets, remove, clear };
}
