import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/* Живые обновления: один SSE-поток на токен (fetch со стримингом — чтобы передать заголовок
   авторизации), подписчики получают «что-то изменилось» и перечитывают своё состояние. */

type Listener = (what: string[]) => void;

interface Hub {
  listeners: Set<Listener>;
  status: Set<(connected: boolean) => void>;
  abort: AbortController | null;
  connected: boolean;
}

const hubs = new Map<string, Hub>();

function hubFor(token: string): Hub {
  let hub = hubs.get(token);
  if (!hub) {
    hub = { listeners: new Set(), status: new Set(), abort: null, connected: false };
    hubs.set(token, hub);
  }
  return hub;
}

function setConnected(hub: Hub, value: boolean) {
  if (hub.connected === value) return;
  hub.connected = value;
  hub.status.forEach((f) => f(value));
}

async function run(token: string, hub: Hub) {
  let delay = 800;
  while (hub.listeners.size > 0) {
    const ctrl = new AbortController();
    hub.abort = ctrl;
    try {
      const res = await fetch("/api/live", { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      if (res.status === 401) {
        setConnected(hub, false);
        hub.listeners.forEach((l) => l(["unauthorized"]));
        return;
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      setConnected(hub, true);
      delay = 800;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (event === "change" || event === "hello") {
            let what: string[] = [event];
            try { what = JSON.parse(data).what ?? what; } catch { /* ignore */ }
            hub.listeners.forEach((l) => l(what));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    setConnected(hub, false);
    if (hub.listeners.size === 0) return;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.8, 10_000);
  }
}

function subscribe(token: string, listener: Listener, onStatus: (c: boolean) => void): () => void {
  const hub = hubFor(token);
  const first = hub.listeners.size === 0;
  hub.listeners.add(listener);
  hub.status.add(onStatus);
  onStatus(hub.connected);
  if (first) void run(token, hub);
  return () => {
    hub.listeners.delete(listener);
    hub.status.delete(onStatus);
    if (hub.listeners.size === 0) {
      hub.abort?.abort();
      hubs.delete(token);
    }
  };
}

/** Состояние с сервера, которое само обновляется по живому каналу (и раз в fallbackMs на всякий случай). */
export function useLive<T>(token: string | null, fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { deps?: unknown[]; fallbackMs?: number; debounceMs?: number; filter?: (what: string[]) => boolean } = {}) {
  const { deps = [], fallbackMs = 20_000, debounceMs = 120, filter } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [connected, setConnectedState] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastWhat = useRef<string[]>([]);

  const reload = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const d = await fetcherRef.current(ctrl.signal);
      if (!ctrl.signal.aborted) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    }
  }, []);

  const schedule = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void reload(), delay);
  }, [reload]);

  useEffect(() => {
    setData(null);
    void reload();
    if (!token) return;
    const unsub = subscribe(token, (what) => {
      lastWhat.current = what;
      if (what.includes("unauthorized")) { void reload(); return; }
      if (filterRef.current && !filterRef.current(what)) return;
      schedule(debounceMs);
    }, setConnectedState);
    const poll = window.setInterval(() => void reload(), fallbackMs);
    const onVisible = () => { if (!document.hidden) void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
      inflight.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ...deps]);

  return { data, error, reload, connected, setData, lastWhat };
}

/** Серверное «сейчас» с поправкой на расхождение часов. */
export function useServerClock(serverNow: string | undefined) {
  const skew = useRef(0);
  useEffect(() => {
    if (serverNow) skew.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return () => Date.now() + skew.current;
}
