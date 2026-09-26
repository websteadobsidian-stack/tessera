import { STAGES, num, stageColor } from "../format";
import type { Debrief } from "../types";
import { TipValue, useTooltip } from "./Tooltip";

/** Карта процесса: этапы слева направо, толщина стрелки — число переходов,
 *  подпись — среднее время перехода. Возвраты на доработку — дуги снизу. */
export function ProcessMap({ dfg, waiting }: { dfg: Debrief["dfg"]; waiting: Record<string, number> }) {
  const tip = useTooltip();
  const NW = 132, NH = 64, W = 960;
  const hasSkip = dfg.edges.some((e) => !e.rework && STAGES.indexOf(e.target as never) - STAGES.indexOf(e.source as never) > 1);
  const maxBack = Math.max(0, ...dfg.edges.filter((e) => e.rework).map((e) => STAGES.indexOf(e.source as never) - STAGES.indexOf(e.target as never)));
  const Y = hasSkip ? 130 : 64;
  const H = Y + NH / 2 + (maxBack ? 64 + maxBack * 16 : 24);
  const x = (i: number) => 112 + i * ((W - 224) / (STAGES.length - 1));
  const maxCount = Math.max(1, ...dfg.edges.map((e) => e.count));
  const width = (c: number) => 1.5 + (c / maxCount) * 4.5;
  const visits = Object.fromEntries(dfg.nodes.map((n) => [n.stage, n.visits]));
  const bottleneck = Object.entries(waiting).sort((a, b) => b[1] - a[1])[0]?.[0];
  const idx = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);

  if (!dfg.edges.length && !Object.keys(dfg.starts).length) {
    return <div className="empty"><div className="big">Карта появится, когда задачи начнут двигаться</div></div>;
  }

  return (
    <div className="chart">
      <div className="chart-scroll"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Карта процесса команды">
        <defs>
          {["ink", "warn"].map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill={`var(--${k === "ink" ? "ink-2" : "warn"})`} />
            </marker>
          ))}
        </defs>

        {/* старт и финиш */}
        <circle cx={18} cy={Y} r={8} fill="var(--ink)" />
        <line x1={28} y1={Y} x2={x(0) - NW / 2 - 4} y2={Y} stroke="var(--ink-2)" strokeWidth={1.5} markerEnd="url(#arrow-ink)" />
        <circle cx={W - 18} cy={Y} r={9} fill="none" stroke="var(--ink)" strokeWidth={2} />
        <circle cx={W - 18} cy={Y} r={4.5} fill="var(--ink)" />
        <line x1={x(4) + NW / 2 + 2} y1={Y} x2={W - 30} y2={Y} stroke="var(--ink-2)" strokeWidth={1.5} markerEnd="url(#arrow-ink)" />

        {dfg.edges.map((e) => {
          const a = idx(e.source), b = idx(e.target);
          const mins = e.mean_hours * 60;
          const label = `${e.count}× · ${num(mins)} мин`;
          let d: string, lx: number, ly: number;
          if (e.rework) {
            const x1 = x(a) - 18, x2 = x(b) + 18, depth = 44 + (a - b) * 16;
            d = `M${x1},${Y + NH / 2} C${x1},${Y + NH / 2 + depth} ${x2},${Y + NH / 2 + depth} ${x2},${Y + NH / 2 + 2}`;
            lx = (x1 + x2) / 2; ly = Y + NH / 2 + depth * 0.75 + 16;
          } else if (b === a + 1) {
            d = `M${x(a) + NW / 2 + 2},${Y} L${x(b) - NW / 2 - 3},${Y}`;
            lx = (x(a) + x(b)) / 2; ly = Y - 10;
          } else {
            const x1 = x(a) + 18, x2 = x(b) - 18, h = 40 + (b - a) * 14;
            d = `M${x1},${Y - NH / 2} C${x1},${Y - NH / 2 - h} ${x2},${Y - NH / 2 - h} ${x2},${Y - NH / 2 - 2}`;
            lx = (x1 + x2) / 2; ly = Y - NH / 2 - h * 0.75 - 6;
          }
          const color = e.rework ? "var(--warn)" : "var(--ink-2)";
          const content = <TipValue value={`${e.count} ${e.rework ? "возвр." : "перех."} · ${num(mins)} мин`}
            label={`${e.source} → ${e.target}${e.rework ? " (доработка)" : ""}`} />;
          return (
            <g key={`${e.source}-${e.target}`}>
              <path d={d} fill="none" stroke={color} strokeWidth={width(e.count)} strokeLinecap="round"
                markerEnd={`url(#arrow-${e.rework ? "warn" : "ink"})`} opacity={0.9} />
              <path d={d} fill="none" stroke="transparent" strokeWidth={22}
                onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide} />
              {!e.rework && b === a + 1 ? (
                <>
                  <text x={lx} y={ly} textAnchor="middle" className="label-strong" style={{ fontSize: 12 }}>{e.count}×</text>
                  <text x={lx} y={Y + 20} textAnchor="middle" style={{ fontSize: 11 }}>{num(mins)} мин</text>
                </>
              ) : (
                <text x={lx} y={ly} textAnchor="middle" className={e.rework ? "" : "label-strong"}
                  style={{ fontSize: 12, fill: e.rework ? "var(--warn)" : undefined, fontWeight: e.rework ? 600 : undefined }}>{label}</text>
              )}
            </g>
          );
        })}

        {STAGES.map((s, i) => {
          const w = waiting[s];
          const hot = s === bottleneck && (w ?? 0) > 0;
          const content = <TipValue value={`${visits[s] ?? 0} посещ.`}
            label={<>{s}{w !== undefined ? ` · ожидание ${num(w)} мин` : ""}{hot ? " · узкое место" : ""}</>} />;
          return (
            <g key={s} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide}>
              <rect x={x(i) - NW / 2} y={Y - NH / 2} width={NW} height={NH} rx={14}
                fill="var(--surface)" stroke={hot ? "var(--ink)" : "var(--line-strong)"} strokeWidth={hot ? 2 : 1} />
              <rect x={x(i) - NW / 2 + 10} y={Y - NH / 2 + 12} width={4} height={NH - 24} rx={2} fill={stageColor(s)} />
              <text x={x(i) - NW / 2 + 22} y={Y - 6} className="label-strong" style={{ fontSize: 13 }}>{s}</text>
              <text x={x(i) - NW / 2 + 22} y={Y + 13} style={{ fontSize: 12 }}>
                {visits[s] ?? 0}×{w !== undefined ? ` · ${num(w)} мин` : ""}
              </text>
              {hot && (
                <g>
                  <rect x={x(i) - 44} y={Y - NH / 2 - 11} width={88} height={20} rx={10} fill="var(--ink)" />
                  <text x={x(i)} y={Y - NH / 2 + 3} textAnchor="middle" style={{ fontSize: 11, fill: "var(--ink-inverse)", fontWeight: 650 }}>узкое место</text>
                </g>
              )}
            </g>
          );
        })}
      </svg></div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><span className="key-line" style={{ width: 18, height: 3, background: "var(--ink-2)", display: "inline-block", borderRadius: 2 }} />переход (толщина — сколько раз)</span>
        <span><span className="key-line" style={{ width: 18, height: 3, background: "var(--warn)", display: "inline-block", borderRadius: 2 }} />возврат на доработку</span>
        <span>в узле: сколько раз задачи заходили на этап · сколько в среднем ждали начала работы</span>
      </div>
      {tip.node}
    </div>
  );
}
