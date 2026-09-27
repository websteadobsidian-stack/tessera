import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, Play, RotateCcw } from "lucide-react";
import { clockSec } from "../lib/format";
import { personColor, shortName } from "../lib/people";
import type { Tile } from "../lib/types";
import { TipValue, useTooltip } from "../ui/tooltip";
import { exportSvgPng } from "./exportPng";

type PersonLike = { participant_id: string; display_name?: string | null; role_title?: string; role?: string; color_slot: number };

export const KIND_TITLES: Record<string, string> = {
  start: "взял(а) задачу в работу",
  step: "передал(а) задачу на этап",
  done: "сдал(а) задачу",
  rework: "вернул(а) на доработку",
  handover: "передача работы",
  fact: "выложил(а) факт на стол",
  vote: "проголосовал(а)",
  decision: "решение команды",
  milestone: "закрыл(а) веху",
  kudos: "сказал(а) «спасибо»",
  help: "попросил(а) помощи",
  helped: "пришёл(ла) на помощь",
  message: "сообщение в Эфире",
  achievement: "командное достижение",
};

export const LEGEND_KINDS = ["start", "handover", "done", "rework", "fact", "kudos", "helped", "decision", "achievement"];

/** Позиции по спирали от центра: портрет растёт наружу, как мозаика. */
function spiral(n: number, cols: number): [number, number][] {
  const rows = cols;
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const cells: [number, number, number, number][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = x - cx, dy = y - cy;
      cells.push([x, y, Math.hypot(dx, dy * 1.02), Math.atan2(dy, dx)]);
    }
  }
  cells.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
  return cells.slice(0, n).map(([x, y]) => [x, y]);
}

export function Glyph({ kind, x, y, s }: { kind: string; x: number; y: number; s: number }) {
  const c = "rgba(255,255,255,0.88)";
  const r = s * 0.13;
  const cx = x + s / 2, cy = y + s / 2;
  switch (kind) {
    case "start":
      return <circle cx={cx} cy={cy} r={r} fill={c} />;
    case "step":
      return <rect x={cx - s * 0.2} y={cy - s * 0.045} width={s * 0.4} height={s * 0.09} rx={s * 0.045} fill={c} />;
    case "done":
      return <polyline points={`${cx - s * 0.17},${cy + s * 0.01} ${cx - s * 0.04},${cy + s * 0.14} ${cx + s * 0.19},${cy - s * 0.13}`}
        fill="none" stroke={c} strokeWidth={s * 0.09} strokeLinecap="round" strokeLinejoin="round" />;
    case "rework":
      return <circle cx={cx} cy={cy} r={s * 0.16} fill="none" stroke={c} strokeWidth={s * 0.08} strokeDasharray={`${s * 0.6} ${s * 0.3}`} />;
    case "fact":
      return <rect x={cx - r * 1.2} y={cy - r * 1.2} width={r * 2.4} height={r * 2.4} fill={c} transform={`rotate(45 ${cx} ${cy})`} />;
    case "vote":
      return <rect x={cx - r * 1.1} y={cy - r * 1.1} width={r * 2.2} height={r * 2.2} rx={r * 0.4} fill="none" stroke={c} strokeWidth={s * 0.07} />;
    case "decision":
    case "achievement": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const rr = i % 2 === 0 ? s * 0.26 : s * 0.11;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      }).join(" ");
      return <polygon points={pts} fill={kind === "achievement" ? "#3b2500" : c} />;
    }
    case "milestone":
      return <polygon points={`${cx - s * 0.14},${cy + s * 0.18} ${cx - s * 0.14},${cy - s * 0.18} ${cx + s * 0.18},${cy - s * 0.06}`} fill={c} />;
    case "kudos": {
      const k = s * 0.0095;
      return <path transform={`translate(${cx - 12 * k} ${cy - 11 * k}) scale(${k})`} fill={c}
        d="M12 21s-7.5-4.6-9.6-9.2C.6 7.6 3.4 3.5 7.3 3.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.9 0 6.7 4.1 4.9 8.3C19.5 16.4 12 21 12 21z" />;
    }
    case "help":
    case "helped":
      return (
        <g stroke={c} strokeWidth={s * 0.09} strokeLinecap="round">
          <line x1={cx - s * 0.16} y1={cy} x2={cx + s * 0.16} y2={cy} />
          <line x1={cx} y1={cy - s * 0.16} x2={cx} y2={cy + s * 0.16} />
        </g>
      );
    case "message":
      return <g fill={c} opacity={0.7}><circle cx={cx - s * 0.1} cy={cy} r={s * 0.05} /><circle cx={cx + s * 0.1} cy={cy} r={s * 0.05} /></g>;
    default:
      return null;
  }
}

export function Mosaic({ tiles, people, size = 420, live = false, replayable = true, exportName, showLegend = true, minCols = 10, highlight }: {
  tiles: Tile[]; people: PersonLike[]; size?: number; live?: boolean; replayable?: boolean; exportName?: string;
  showLegend?: boolean; minCols?: number; highlight?: string | null;
}) {
  const tip = useTooltip();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = { clip: `tile-clip-${uid}`, gold: `gold-${uid}`, sheen: `sheen-${uid}` };
  const svgRef = useRef<SVGSVGElement>(null);
  const [focus, setFocus] = useState<string | null>(highlight ?? null);
  const [visible, setVisible] = useState<number | null>(null);
  const seen = useRef<number>(tiles.length);
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.participant_id, p])), [people]);
  const cols = Math.max(minCols, Math.ceil(Math.sqrt(Math.max(1, tiles.length) * 1.12)));
  const gap = Math.max(1.5, size / cols * 0.1);
  const s = (size - gap * (cols + 1)) / cols;
  const pos = useMemo(() => spiral(tiles.length, cols), [tiles.length, cols]);
  const shown = visible ?? tiles.length;

  useEffect(() => { setFocus(highlight ?? null); }, [highlight]);
  useEffect(() => {
    const t = window.setTimeout(() => { seen.current = tiles.length; }, 50);
    return () => window.clearTimeout(t);
  }, [tiles.length]);

  const replay = () => {
    const total = tiles.length;
    const start = performance.now();
    const duration = Math.min(9000, 2500 + total * 12);
    setVisible(0);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 2.2);
      setVisible(Math.round(eased * total));
      if (p < 1) requestAnimationFrame(step);
      else setVisible(null);
    };
    requestAnimationFrame(step);
  };

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    tiles.forEach((t) => {
      if (t.a) m[t.a] = (m[t.a] ?? 0) + 1;
      if (t.b) m[t.b] = (m[t.b] ?? 0) + 1;
    });
    return m;
  }, [tiles]);

  const colorOf = (pid: string | null | undefined) => (pid && byId[pid] ? personColor(byId[pid].color_slot) : "var(--glass-3)");

  return (
    <div className={`mosaic ${showLegend ? "" : "solo"}`}>
      <div className="mosaic-canvas" style={{ width: "100%", maxWidth: size }}>
        <svg ref={svgRef} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Портрет команды: мозаика из действий участников">
          <defs>
            <clipPath id={ids.clip} clipPathUnits="objectBoundingBox">
              <rect x="0" y="0" width="1" height="1" rx="0.24" ry="0.24" />
            </clipPath>
            <linearGradient id={ids.gold} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f9df83" />
              <stop offset="1" stopColor="#e39a2f" />
            </linearGradient>
            <linearGradient id={ids.sheen} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {Array.from({ length: cols * cols }, (_, i) => {
            const x = gap + (i % cols) * (s + gap), y = gap + Math.floor(i / cols) * (s + gap);
            return <rect key={`bg${i}`} x={x} y={y} width={s} height={s} rx={s * 0.24} fill="var(--glass)" />;
          })}
          {tiles.slice(0, shown).map((t, i) => {
            const [gx, gy] = pos[i];
            const x = gap + gx * (s + gap), y = gap + gy * (s + gap);
            const dim = focus && t.a !== focus && t.b !== focus;
            const fresh = live && i >= seen.current;
            const a = byId[t.a ?? ""], b = t.b ? byId[t.b] : undefined;
            const label = t.k === "achievement" ? "Командное достижение"
              : `${shortName(a)}${b ? ` → ${shortName(b)}` : ""}`;
            return (
              <motion.g key={i} clipPath={`url(#${ids.clip})`}
                initial={fresh || visible !== null ? { opacity: 0, scale: 0.2 } : false}
                animate={{ opacity: dim ? 0.18 : t.k === "message" ? 0.62 : 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
                style={{ transformOrigin: `${x + s / 2}px ${y + s / 2}px`, transformBox: "view-box" }}
                onPointerMove={(e) => tip.show(e, <TipValue value={KIND_TITLES[t.k] ?? t.k} label={<>{label} · {clockSec(t.t)}</>} />)}
                onPointerLeave={tip.hide}>
                <rect x={x} y={y} width={s} height={s} fill={t.k === "achievement" ? `url(#${ids.gold})` : colorOf(t.a)} />
                {b && <polygon points={`${x + s},${y} ${x + s},${y + s} ${x},${y + s}`} fill={colorOf(t.b)} />}
                <rect x={x} y={y} width={s} height={s} fill={`url(#${ids.sheen})`} />
                {s >= 9 && <Glyph kind={t.k} x={x} y={y} s={s} />}
              </motion.g>
            );
          })}
        </svg>
      </div>
      {showLegend && (
        <div className="mosaic-legend">
          <div className="mosaic-people">
            {people.map((p) => (
              <button key={p.participant_id} className={`mosaic-person ${focus === p.participant_id ? "on" : ""}`}
                onMouseEnter={() => setFocus(p.participant_id)} onMouseLeave={() => setFocus(highlight ?? null)}
                onFocus={() => setFocus(p.participant_id)} onBlur={() => setFocus(highlight ?? null)}>
                <span className="swatch" style={{ background: personColor(p.color_slot), width: 12, height: 12, borderRadius: 4 }} />
                <span className="ellipsis">{shortName(p)}</span>
                <span className="muted mono tiny">{counts[p.participant_id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="mosaic-kinds">
            {LEGEND_KINDS.map((k) => (
              <span key={k} className="mosaic-kind">
                <svg width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="4.5"
                  fill={k === "achievement" ? `url(#${ids.gold})` : "var(--ink-3)"} />
                  {k === "handover" && <polygon points="18,0 18,18 0,18" fill="var(--ink-2)" />}
                  <Glyph kind={k} x={0} y={0} s={18} /></svg>
                {KIND_TITLES[k]}
              </span>
            ))}
          </div>
          {(replayable || exportName) && (
            <div className="row wrap" style={{ gap: 8 }}>
              {replayable && tiles.length > 4 && (
                <button className="btn sm" onClick={replay} disabled={visible !== null}>
                  {visible === null ? <Play size={14} /> : <RotateCcw size={14} />} Проиграть сессию
                </button>
              )}
              {exportName && (
                <button className="btn sm ghost" onClick={() => svgRef.current && exportSvgPng(svgRef.current, exportName)}>
                  <Download size={14} /> Скачать портрет
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {tip.node}
    </div>
  );
}
