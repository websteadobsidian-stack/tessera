import { CONDITIONS, condColor, num } from "../format";
import { TipValue, useTooltip } from "./Tooltip";

/** Горизонтальные столбцы одной серии (например, ожидание по этапам). */
export function HBars({ rows, unit, color = "var(--seq-3)" }: { rows: { label: string; value: number }[]; unit: string; color?: string }) {
  const tip = useTooltip();
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="small muted">Нет данных.</p>;
  return (
    <div className="stack sm">
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ gap: 10 }}
          onPointerMove={(e) => tip.show(e, <TipValue value={`${num(r.value)} ${unit}`} label={r.label} />)} onPointerLeave={tip.hide}>
          <span className="small" style={{ width: 118, flex: "none" }}>{r.label}</span>
          <div className="grow" style={{ height: 14, background: "var(--surface-2)", borderRadius: 4 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0, height: "100%", background: color, borderRadius: "0 4px 4px 0" }} />
          </div>
          <span className="small mono" style={{ width: 70, textAlign: "right" }}>{num(r.value)} {unit}</span>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

export interface ConditionMetric {
  key: string;
  title: string;
  hint: string;
  format: (v: number) => string;
  better?: "lower" | "higher";
}

/** Малые множители: одна карточка на метрику, четыре столбца — четыре методики. */
export function ConditionBars({ data, metric }: { data: Record<string, Record<string, number | null>>; metric: ConditionMetric }) {
  const tip = useTooltip();
  const W = 280, H = 170, B = 36, T = 22;
  const vals = CONDITIONS.map((c) => ({ c, v: data[c.key]?.[metric.key] ?? null, n: data[c.key]?.teams ?? 0 }));
  const max = Math.max(1e-9, ...vals.map((x) => x.v ?? 0));
  const bw = 40, gap = (W - bw * 4) / 5;
  return (
    <div className="card tight flat stack sm">
      <div className="stack" style={{ gap: 2 }}>
        <h4>{metric.title}</h4>
        <span className="tiny muted">{metric.hint}{metric.better ? ` · лучше ${metric.better === "lower" ? "ниже" : "выше"}` : ""}</span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={metric.title}>
          <line className="axis-line" x1={0} x2={W} y1={H - B} y2={H - B} />
          {vals.map(({ c, v, n }, i) => {
            const x = gap + i * (bw + gap);
            const h = v === null ? 0 : Math.max(2, (v / max) * (H - B - T));
            const content = <TipValue value={v === null ? "нет данных" : metric.format(v)} label={`${c.title} · команд: ${n}`} />;
            return (
              <g key={c.key} onPointerMove={(e) => tip.show(e, content)} onPointerLeave={tip.hide}>
                <rect className="hit" x={x - gap / 2} y={0} width={bw + gap} height={H} />
                {v !== null && <path d={`M${x},${H - B} V${H - B - h + 4} Q${x},${H - B - h} ${x + 4},${H - B - h} H${x + bw - 4} Q${x + bw},${H - B - h} ${x + bw},${H - B - h + 4} V${H - B} Z`} fill={condColor(c.key)} />}
                <text x={x + bw / 2} y={v === null ? H - B - 6 : H - B - h - 6} textAnchor="middle" className="label-strong" style={{ fontSize: 12 }}>
                  {v === null ? "—" : metric.format(v)}
                </text>
                <text x={x + bw / 2} y={H - B + 15} textAnchor="middle" style={{ fontSize: 11 }}>{c.title.length > 9 ? c.title.slice(0, 8) + "." : c.title}</text>
                <text x={x + bw / 2} y={H - B + 28} textAnchor="middle" style={{ fontSize: 10, fill: "var(--ink-3)" }}>n={n}</text>
              </g>
            );
          })}
        </svg>
        {tip.node}
      </div>
    </div>
  );
}
