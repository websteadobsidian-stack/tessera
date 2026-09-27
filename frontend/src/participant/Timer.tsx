import type { ReactNode } from "react";
import { mmss } from "../lib/format";
import { useServerClock } from "../lib/live";
import type { SessionInfo } from "../lib/types";
import { Ring } from "../ui/core";

export function useWorkClock(session: SessionInfo) {
  const now = useServerClock(session.now);
  if (!session.work_started_at) return null;
  const start = new Date(session.work_started_at).getTime();
  const total = session.work_minutes * 60_000;
  const left = start + total - now();
  return { left, total, progress: Math.min(1, Math.max(0, 1 - left / total)), minute: (now() - start) / 60000 };
}

export function TimerPill({ session, big }: { session: SessionInfo; big?: boolean }) {
  const c = useWorkClock(session);
  if (!c) return null;
  const low = c.left < Math.max(60_000, c.total * 0.1);
  return (
    <span className={`timer-pill ${low ? "low" : ""}`} title="До конца рабочей сессии" style={big ? { height: 48, paddingRight: 18 } : undefined}>
      <Ring value={c.progress} size={big ? 34 : 26} stroke={big ? 4 : 3.5} color={low ? "var(--bad)" : undefined} />
      <span className="digits" style={big ? { fontSize: 22 } : undefined}>{c.left < 0 ? "+" : ""}{mmss(c.left / 1000)}</span>
    </span>
  );
}

/** Обратный отсчёт до момента `to` по серверным часам. Лист — чтобы секундный тик не перерисовывал всё дерево. */
export function Countdown({ to, serverNow, over, prefix }: { to: string | null | undefined; serverNow: string; over?: ReactNode; prefix?: ReactNode }) {
  const now = useServerClock(serverNow);
  if (!to) return null;
  const left = new Date(to).getTime() - now();
  if (left <= 0 && over !== undefined) return <>{over}</>;
  return <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>{prefix}{left < 0 ? "−" : ""}{mmss(left / 1000)}</span>;
}

/** Остаток времени до `to` (мс) — для компонентов, которым нужно само число. */
export function useLeft(to: string | null | undefined, serverNow: string) {
  const now = useServerClock(serverNow);
  return to ? new Date(to).getTime() - now() : null;
}
