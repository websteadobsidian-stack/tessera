import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { store } from "../api";

/* ---------------------------------------------------------------- логотип */

const TILE = ["var(--stage-1)", "var(--stage-2)", "var(--stage-3)", "var(--stage-4)", "var(--ink)", "var(--stage-5)"];

export function Logo({ size = 28 }: { size?: number }) {
  const s = size / 3;
  const cells = [0, 1, 2, 3, 4, 5, 3, 0, 1];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {cells.map((c, i) => (
        <rect key={i} x={(i % 3) * s + 1} y={Math.floor(i / 3) * s + 1} width={s - 2} height={s - 2}
          rx={s * 0.22} fill={TILE[c]} opacity={i === 4 ? 1 : 0.92} />
      ))}
    </svg>
  );
}

export function Brand({ sub, to = "/" }: { sub?: string; to?: string }) {
  return (
    <Link to={to} className="brand">
      <Logo />
      <span className="word">Tessera</span>
      {sub && <span className="sub">{sub}</span>}
    </Link>
  );
}

/* ---------------------------------------------------------------- иконки */

const paths: Record<string, ReactNode> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  play: <path d="M7 5v14l11-7z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  file: <><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  note: <><path d="M4 4h16v12l-4 4H4z" /><path d="M16 20v-4h4M8 9h8M8 13h5" /></>,
  logout: <path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l-4-4 4-4M6 12h11" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  rework: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
};

export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}

/* ---------------------------------------------------------------- тосты */

type Toast = { id: number; text: string; kind: "info" | "error" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 5200 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            <Icon name={t.kind === "error" ? "alert" : "check"} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Обёртка для действий: показывает ошибку сервера тостом. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy };
}

/* ---------------------------------------------------------------- оверлеи */

export function Drawer({ onClose, children, title, subtitle }: { onClose: () => void; children: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="grow stack sm">
            {subtitle}
            <h3>{title}</h3>
          </div>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </>
  );
}

/* ---------------------------------------------------------------- мелочи */

export function Empty({ title, children, icon = "sparkle" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <div style={{ marginBottom: 10, color: "var(--ink-3)" }}><Icon name={icon} size={28} /></div>
      <div className="big">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => store.get("tessera.theme"));
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return (
    <button className="btn ghost icon-btn" aria-label={dark ? "Светлая тема" : "Тёмная тема"} title={dark ? "Светлая тема" : "Тёмная тема"}
      onClick={() => { const next = dark ? "light" : "dark"; store.set("tessera.theme", next); setTheme(next); }}>
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}

/** Обратный отсчёт рабочей фазы, с поправкой на часы сервера. */
export function Countdown({ startedAt, minutes, serverNow }: { startedAt: string | null; minutes: number; serverNow: string }) {
  const [skew] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const end = new Date(startedAt).getTime() + minutes * 60_000;
  const left = Math.round((end - (Date.now() + skew)) / 1000);
  const abs = Math.abs(left);
  const mm = String(Math.floor(abs / 60)).padStart(2, "0");
  const ss = String(abs % 60).padStart(2, "0");
  return (
    <span className={`timer ${left < 300 ? "low" : ""}`} title="До конца рабочей сессии">
      {left < 0 ? "+" : ""}{mm}:{ss}
    </span>
  );
}

export function Avatar({ text, me, lg, title }: { text: string; me?: boolean; lg?: boolean; title?: string }) {
  return <span className={`avatar ${me ? "me" : ""} ${lg ? "lg" : ""}`} title={title}>{text}</span>;
}
