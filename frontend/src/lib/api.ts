export const TOKENS = {
  participant: "tessera.participant",
  admin: "tessera.admin",
  director: "tessera.director",
  demoTeam: "tessera.demo.team",
} as const;

export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  },
  del(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Opts = { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal };

export async function api<T = unknown>(path: string, { method = "GET", body, token, signal }: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
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
  saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Токен ведущего: полный по паролю или «режиссёрский» от демо-песочницы. */
export function facilitatorToken(): string | null {
  return store.get(TOKENS.admin) || store.get(TOKENS.director);
}
