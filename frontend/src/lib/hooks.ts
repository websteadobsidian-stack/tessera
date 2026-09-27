import { useCallback, useEffect, useRef, useState } from "react";
import { store } from "./api";

/** Совпадение медиа-запроса (узкий экран, предпочтение анимаций и т. п.). */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Состояние, которое переживает перезагрузку страницы (только для удобства — не для данных). */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = store.get(key);
    if (raw === null) return initial;
    try { return JSON.parse(raw) as T; } catch { return initial; }
  });
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      store.set(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  return [value, set] as const;
}

/** Ключи, которые компонент уже видел: новые элементы можно подсветить, а старые — нет. */
export function useSeen<T extends string | number>(ids: T[]) {
  const seen = useRef<Set<T> | null>(null);
  const fresh = new Set<T>();
  if (seen.current === null) {
    seen.current = new Set(ids);
  } else {
    for (const id of ids) if (!seen.current.has(id)) fresh.add(id);
  }
  useEffect(() => { ids.forEach((id) => seen.current!.add(id)); });
  return fresh;
}
