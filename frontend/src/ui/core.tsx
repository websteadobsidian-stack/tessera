import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CloudLightning, CloudRain, CloudSun, Dumbbell, HandHelping, HeartHandshake, Lightbulb, Moon, Sparkles, Sun,
} from "lucide-react";
import { store } from "../lib/api";
import { initials, personColor } from "../lib/people";

/* ------------------------------------------------------------------ логотип */

const LOGO_TILES = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--accent)", "var(--p5)", "var(--p3)", "var(--p1)", "var(--p2)"];

export function Logo({ size = 28, alive = false }: { size?: number; alive?: boolean }) {
  const s = size / 3;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {LOGO_TILES.map((c, i) => (
        <motion.rect key={i} x={(i % 3) * s + 1} y={Math.floor(i / 3) * s + 1} width={s - 2} height={s - 2} rx={s * 0.24}
          fill={c}
          initial={alive ? { opacity: 0, scale: 0.3 } : false}
          animate={alive ? { opacity: [0.55, 1, 0.75], scale: 1 } : { opacity: i === 4 ? 1 : 0.9 }}
          transition={alive ? { delay: i * 0.05, duration: 2.4, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" } : undefined}
          style={{ transformOrigin: `${(i % 3) * s + s / 2}px ${Math.floor(i / 3) * s + s / 2}px` }} />
      ))}
    </svg>
  );
}

export function Brand({ sub, to = "/" }: { sub?: string; to?: string }) {
  return (
    <Link to={to} className="brand">
      <Logo />
      <span className="word">tessera</span>
      {sub && <span className="sub">{sub}</span>}
    </Link>
  );
}

/* ------------------------------------------------------------------ плитка участника */

export function PersonTile({ person, size, online, badge, title, muted, style }: {
  person: { display_name?: string | null; role_title?: string; role?: string; color_slot?: number | null } | null | undefined;
  size?: "xs" | "sm" | "lg" | "xl" | "xxl"; online?: boolean; badge?: ReactNode; title?: string; muted?: boolean; style?: CSSProperties;
}) {
  return (
    <span className={`tile ${size ?? ""} ${muted ? "muted" : ""}`} title={title}
      style={{ ["--c" as string]: personColor(person?.color_slot), ...style }}>
      {initials(person)}
      {online !== undefined && <span className={`status ${online ? "on" : ""}`} />}
      {badge !== undefined && badge !== null && <span className="badge">{badge}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ числа и кольца */

export function AnimatedNumber({ value, digits = 0, suffix = "" }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }) + suffix);
  useEffect(() => {
    if (value === null || value === undefined) return;
    const controls = animate(mv, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] });
    return () => controls.stop();
  }, [value, mv]);
  if (value === null || value === undefined) return <>—</>;
  return <motion.span>{text}</motion.span>;
}

export function Ring({ value, size = 44, stroke = 5, color, children, track }: {
  value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-grid", placeItems: "center", flex: "none" }}>
      <svg width={size} height={size} className="ring" style={{ position: "absolute", inset: 0 }}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={track ? { stroke: track } : undefined} />
        <circle className="value" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={color ? { stroke: color } : undefined} />
      </svg>
      <span style={{ position: "relative", fontSize: size > 60 ? 16 : 11, fontWeight: 700 }}>{children}</span>
    </span>
  );
}

export function Stat({ k, v, unit, d, digits = 0, raw }: { k: string; v: number | null | undefined; unit?: string; d?: ReactNode; digits?: number; raw?: ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{raw ?? <AnimatedNumber value={v} digits={digits} />}{unit && v !== null && v !== undefined && <small>{unit}</small>}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ управляющие элементы */

export function Tabs<T extends string>({ items, value, onChange, id }: {
  items: { key: T; title: ReactNode; count?: number; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; id?: string;
}) {
  const auto = useId();
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={value === it.key} onClick={() => onChange(it.key)}>
          {it.icon}{it.title}
          {!!it.count && <span className="count">{it.count}</span>}
          {value === it.key && <motion.span layoutId={`tab-${id ?? auto}`} className="underline" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ items, value, onChange }: {
  items: { key: T; title: ReactNode }[]; value: T; onChange: (v: T) => void;
}) {
  const uid = useId();
  return (
    <div className="segmented" role="group">
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={value === it.key} onClick={() => onChange(it.key)}>
          {value === it.key && <motion.span layoutId={`seg-${uid}`} className="seg-pill" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
          <span className="seg-label">{it.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Уровень сыгранности как пять плиток: от «Фрагментов» до «Картины». Текущая плитка дышит. */
export function LevelMeter({ index, score, title }: { index: number; score: number; title: string }) {
  return (
    <span className="level-meter" title={`Сыгранность ${score} · ${title}`}>
      <span className="lm-tiles" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.i key={i} className={i < index ? "on" : i === index ? "cur" : ""}
            animate={i === index ? { opacity: [0.65, 1, 0.65] } : { opacity: 1 }}
            transition={i === index ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : undefined} />
        ))}
      </span>
      <span className="lm-text"><b>{title}</b><small>{score}</small></span>
    </span>
  );
}

/** Мозаичная метка перед заголовком раздела — фирменный знак Tessera. */
export function Mark() {
  return <span className="mark" aria-hidden><i /><i /><i /><i /></span>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled}
      onClick={() => onChange(!checked)} style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined} />
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <MiniMosaic />}
      <div className="big">{title}</div>
      {children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}
    </div>
  );
}

export function MiniMosaic({ size = 36 }: { size?: number }) {
  const cells = [1, 0, 3, 0, 2, 0, 5, 0, 4];
  const s = size / 3;
  return (
    <svg width={size} height={size} aria-hidden>
      {cells.map((c, i) => (
        <rect key={i} x={(i % 3) * s + 1.5} y={Math.floor(i / 3) * s + 1.5} width={s - 3} height={s - 3} rx={3}
          fill={c ? `var(--p${c})` : "var(--glass-3)"} opacity={c ? 0.8 : 1} />
      ))}
    </svg>
  );
}

export function Loader({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="empty" role="status">
      <Logo size={40} alive />
      <div className="small">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ тема */

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => (store.get("tessera.theme") === "light" ? "light" : "dark"));
  useEffect(() => {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    store.set("tessera.theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "light" ? "#f4f2ee" : "#09090d");
  }, [theme]);
  return [theme, setTheme] as const;
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const light = theme === "light";
  return (
    <button className="btn ghost icon sm" aria-label={light ? "Тёмная тема" : "Светлая тема"} title={light ? "Тёмная тема" : "Светлая тема"}
      onClick={() => setTheme(light ? "dark" : "light")}>
      {light ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

/* ------------------------------------------------------------------ иконки механик */

export function WeatherIcon({ value, size = 18 }: { value: number | null | undefined; size?: number }) {
  const v = Math.round(value ?? 0);
  if (v >= 4) return <Sun size={size} color="var(--warn)" />;
  if (v === 3) return <CloudSun size={size} color="var(--ink-2)" />;
  if (v === 2) return <CloudRain size={size} color="var(--p1)" />;
  if (v === 1) return <CloudLightning size={size} color="var(--accent)" />;
  return <CloudSun size={size} color="var(--ink-3)" />;
}

const KUDOS_ICONS: Record<string, typeof Sparkles> = {
  help: HandHelping, info: Lightbulb, load: Dumbbell, support: HeartHandshake, idea: Sparkles,
};

export function KudosIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const I = KUDOS_ICONS[kind] ?? Sparkles;
  return <I size={size} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
