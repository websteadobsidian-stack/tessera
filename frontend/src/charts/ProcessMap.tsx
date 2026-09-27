import { STAGES, num, stageColor } from "../lib/format";
import type { Debrief } from "../lib/types";
import { TipValue, useTooltip } from "../ui/tooltip";

/** Карта процесса: этапы слева направо, толщина стрелки — число переходов, подпись — среднее
 *  время перехода. Возвраты на доработку — дуги снизу, пропуски этапов — дуги сверху. */
export function ProcessMap({ dfg, waiting }: { dfg: Debrief["dfg"]; waiting: Record<string, number> }) {
  const tip = useTooltip();
  const NW = 136, NH = 70, W = 980;
  const idx = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);
  const hasSkip = dfg.edges.some((e) => !e.rework && idx(e.target) - idx(e.source) > 1);
  const maxBack = Math.max(0, ...dfg.edges.filter((e) => e.rework).map((e) => idx(e.source) - idx(e.target)));
  const Y = hasSkip ? 130 : 60;
  const H = Y + NH / 2 + (maxBack ? 70 + maxBack * 16 : 26);
  const x = (i: number) => 112 + i * ((W - 224) / (STAGES.length - 1));
  const maxCount = Math.max(1, ...dfg.edges.map((e) => e.count));
  const width = (c: number) => 1.5 + (c / maxCount) * 5;
  const visits = Object.fromEntries(dfg.nodes.map((n) => [n.stage, n.visits]));
  const bottleneck = Object.entries(waiting).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!dfg.edges.length && !Object.keys(dfg.starts).length) {
    return <div className="empty"><div className="big">Карта появится, когда задачи начнут двигаться</div></div>;
  }

  return (
    <div className="chart">
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Карта процесса команды">
          <defs>
            {[["ink", "var(--ink-2)"], ["warn", "var(--warn)"]].map(([k, c]) => (
              <marker key={k} id={`pm-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11"
                markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill={c} />
              </marker>
            ))}
          </defs>
          <circle cx={30} cy={Y} r={8} fill="var(--ink)" />
          <line x1={40} y1={Y} x2={x(0) - NW / 2 - 4} y2={Y} stroke="var(--ink-3)" strokeWidth={1.5} markerEnd="url(#pm-arrow-ink)" />
          <circle cx={W - 30} cy={Y} r={10} fill="none" stroke="var(--ink)" strokeWidth={2} />
          <circle cx={W - 30} cy={Y} r={5} fill="var(--ink)" />
          <line x1={x(4) + NW / 2 + 2} y1={Y} x2={W - 43} y2={Y} stroke="var(--ink-3)" strokeWidth={1.5} markerEnd="url(#pm-arrow-ink)" />

          {dfg.edges.map((e) => {
            const a = idx(e.source), b = idx(e.target);
            const mins = e.mean_hours * 60;
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
            const content = <TipValue value={`${e.count} × · ${num(mins)} мин`} label={`${e.source} → ${e.target}${e.rework ? " (доработка)" : ""}`} />;
            return (
              <g key={`${e.source}-${e.target}`}>
                <path d={d} fill="none" stroke={color} strokeWidth={width(e.count)} strokeLinecap="round"
                  markerEnd={`url(#pm-arrow-${e.rework ? "warn" : "ink"})`} opacity={0.9} />
                <path d={d} fill="none" stroke="transparent" strokeWidth={22} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide} />
                {!e.rework && b === a + 1 ? (
                  <>
                    <text x={lx} y={ly} textAnchor="middle" className="label-strong">{e.count}×</text>
                    <text x={lx} y={Y + 20} textAnchor="middle" style={{ fontSize: 11 }}>{num(mins)} мин</text>
                  </>
                ) : (
                  <text x={lx} y={ly} textAnchor="middle" style={{ fontSize: 12, fill: e.rework ? "var(--warn)" : undefined, fontWeight: 650 }}>
                    {e.count}× · {num(mins)} мин
                  </text>
                )}
              </g>
            );
          })}

          {STAGES.map((s, i) => {
            const w = waiting[s];
            const hot = s === bottleneck && (w ?? 0) > 0;
            const content = <TipValue value={`${visits[s] ?? 0} посещ.`} label={<>{s}{w !== undefined ? ` · ждали ${num(w)} мин` : ""}{hot ? " · узкое место" : ""}</>} />;
            return (
              <g key={s} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide}>
                <rect x={x(i) - NW / 2} y={Y - NH / 2} width={NW} height={NH} rx={16} fill="var(--panel-solid)"
                  stroke={hot ? "var(--warn)" : "var(--stroke-2)"} strokeWidth={hot ? 2 : 1} />
                <rect x={x(i) - NW / 2 + 12} y={Y - NH / 2 + 14} width={5} height={NH - 28} rx={2.5} fill={stageColor(s)} />
                <text x={x(i) - NW / 2 + 26} y={Y - 6} className="label-strong" style={{ fontSize: 13.5 }}>{s}</text>
                <text x={x(i) - NW / 2 + 26} y={Y + 14} style={{ fontSize: 12 }}>
                  {visits[s] ?? 0}×{w !== undefined ? ` · ${num(w)} мин` : ""}
                </text>
                {hot && (
                  <g>
                    <rect x={x(i) - 46} y={Y - NH / 2 - 11} width={92} height={21} rx={10.5} fill="var(--warn)" />
                    <text x={x(i)} y={Y - NH / 2 + 3.5} textAnchor="middle" style={{ fontSize: 11, fill: "#1a1300", fontWeight: 700 }}>узкое место</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span><span className="key-line" style={{ width: 18, background: "var(--ink-2)" }} />переход (толщина — сколько раз)</span>
        <span><span className="key-line" style={{ width: 18, background: "var(--warn)" }} />возврат на доработку</span>
        <span>в узле: сколько раз задачи заходили на этап · сколько в среднем ждали начала работы</span>
      </div>
      {tip.node}
    </div>
  );
}
