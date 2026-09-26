import { useCallback, useEffect, useRef, useState } from "react";

export const TOKENS = { participant: "tessera.participant", admin: "tessera.admin" } as const;

export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* приватный режим — живём без памяти */ }
  },
  del(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Opts = { method?: string; body?: unknown; token?: string | null };

export async function api<T = unknown>(path: string, { method = "GET", body, token }: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = "Проверьте заполнение полей";
    } catch { /* not json */ }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export async function download(path: string, token: string, filename: string) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, "Не удалось скачать файл");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Периодический опрос сервера. Держит прошлые данные, пока грузятся новые. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      await reload();
      if (alive) timer = window.setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload, setData };
}
