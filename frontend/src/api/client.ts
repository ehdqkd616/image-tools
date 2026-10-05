import type { Asset } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const { code, message, ...extra } = body?.error ?? {};
    return new ApiError(res.status, code ?? "ERROR", message ?? "요청을 처리하지 못했습니다.", extra);
  } catch {
    return new ApiError(res.status, "ERROR", "서버와 통신하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const { method = "GET", body, query } = options;
  let res: Response;
  try {
    res = await fetch(`/api${withQuery(path, query)}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "네트워크 연결을 확인해 주세요.");
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (err.status === 401) window.dispatchEvent(new CustomEvent("auth:expired", { detail: err }));
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface UploadResponse {
  items: Asset[];
  errors: { filename: string; code: string; message: string }[];
}

/** 진행률 표시를 위해 XHR로 업로드 */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* noop */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = body as UploadResponse;
        if (data.items[0]) resolve(data.items[0]);
        else {
          const e = data.errors[0];
          reject(new ApiError(400, e?.code ?? "ERROR", e?.message ?? "업로드하지 못했습니다."));
        }
      } else {
        const e = (body as { error?: { code: string; message: string } } | null)?.error;
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent("auth:expired"));
        reject(
          new ApiError(
            xhr.status,
            e?.code ?? (xhr.status === 413 ? "FILE_TOO_LARGE" : "ERROR"),
            e?.message ?? (xhr.status === 413 ? "파일이 너무 큽니다." : "업로드하지 못했습니다."),
          ),
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", "네트워크 연결을 확인해 주세요."));
    xhr.onabort = () => reject(new ApiError(0, "ABORTED", "업로드를 취소했습니다."));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("files", file, file.name || "image");
    xhr.send(form);
  });
}

/** POST 응답을 파일로 내려받기 (ZIP) */
export async function downloadPost(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const fileUrl = (assetId: string, download = false) =>
  `/api/assets/${assetId}/file${download ? "?download=1" : ""}`;
export const thumbUrl = (assetId: string) => `/api/assets/${assetId}/thumb`;
