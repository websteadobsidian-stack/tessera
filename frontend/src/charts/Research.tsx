import { CONDITIONS, condColor, num } from "../lib/format";
import { TipValue, useTooltip } from "../ui/tooltip";

export interface Metric {
  key: string;
  title: string;
  hint: string;
  format: (v: number) => string;
  better?: "lower" | "higher";
}

type Row = Record<string, unknown> & { condition: string; team_id: string; session_id: string; label?: string };

/** Точки команд по условиям + среднее: при малых выборках честнее столбиков. */
export function ConditionDots({ rows, metric }: { rows: Row[]; metric: Metric }) {
  const tip = useTooltip();
  const W = 300, H = 180, B = 38, T = 16, L = 8, R = 8;
  const vals = rows.map((r) => r[metric.key]).filter((v): v is number => typeof v === "number");
  const max = Math.max(1e-9, ...vals) * 1.1;
  const min = Math.min(0, ...vals);
  const y = (v: number) => H - B - ((v - min) / (max - min || 1)) * (H - T - B);
  const colW = (W - L - R) / CONDITIONS.length;
  return (
    <div className="panel pad-sm flat stack sm">
      <div className="stack xs">
        <h4>{metric.title}</h4>
        <span className="tiny muted">{metric.hint}{metric.better ? ` · лучше ${metric.better === "lower" ? "ниже" : "выше"}` : ""}</span>
      </div>
      <div className="chart dotplot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={metric.title}>
          <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B} />
          {CONDITIONS.map((c, i) => {
            const cx = L + colW * i + colW / 2;
            const points = rows.filter((r) => r.condition === c.key && typeof r[metric.key] === "number");
            const values = points.map((r) => r[metric.key] as number);
            const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            return (
              <g key={c.key}>
                {mean !== null && (
                  <g onPointerMove={(e) => tip.show(e, <TipValue value={metric.format(mean)} label={`${c.title} · среднее по ${values.length}`} />)} onPointerLeave={tip.hide}>
                    <rect className="hit" x={cx - colW / 2} y={0} width={colW} height={H - B} />
                    <line x1={cx - 20} x2={cx + 20} y1={y(mean)} y2={y(mean)} stroke={condColor(c.key)} strokeWidth={3} strokeLinecap="round" />
                  </g>
                )}
                {points.map((r, k) => {
                  const v = r[metric.key] as number;
                  const jitter = ((k * 37) % 17) - 8;
                  return (
                    <circle key={`${r.team_id}${r.session_id}`} cx={cx + jitter} cy={y(v)} r={4.5} fill={condColor(c.key)} opacity={0.55}
                      stroke="var(--bg)" strokeWidth={1.2}
                      onPointerMove={(e) => tip.show(e, <TipValue value={metric.format(v)} label={`${r.team_id}/${r.session_id}${r.label ? ` · ${r.label}` : ""}`} />)}
                      onPointerLeave={tip.hide} />
                  );
                })}
                {mean !== null && (
                  <text x={cx} y={y(mean) - 8} textAnchor="middle" className="label-strong"
                    style={{ fontSize: 11.5, paintOrder: "stroke", stroke: "var(--panel-solid)", strokeWidth: 4, strokeLinejoin: "round", pointerEvents: "none" }}>
                    {metric.format(mean)}
                  </text>
                )}
                <text x={cx} y={H - B + 15} textAnchor="middle" style={{ fontSize: 11 }}>{c.title.length > 9 ? c.title.slice(0, 8) + "." : c.title}</text>
                <text x={cx} y={H - B + 28} textAnchor="middle" style={{ fontSize: 10, fill: "var(--ink-3)" }}>n={points.length}</text>
              </g>
            );
          })}
        </svg>
        {tip.node}
      </div>
    </div>
  );
}

/** Точечная диаграмма для гипотез: каждая точка — команда (или участник). */
export function Scatter({ points, xLabel, yLabel, xFormat, yFormat, r, n, highlight }: {
  points: { x: number; y: number; condition: string; label: string; ring?: boolean }[];
  xLabel: string; yLabel: string; xFormat: (v: number) => string; yFormat: (v: number) => string;
  r: number | null; n: number; highlight?: string;
}) {
  const tip = useTooltip();
  const W = 460, H = 280, L = 48, B = 42, T = 14, R = 14;
  if (!points.length) return <p className="small muted">Недостаточно данных.</p>;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(0, ...ys), ymax = Math.max(...ys);
  const sx = (v: number) => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const sy = (v: number) => H - B - ((v - ymin) / (ymax - ymin || 1)) * (H - T - B);
  return (
    <div className="chart stack sm">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} от ${xLabel}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid-line" x1={L} x2={W - R} y1={sy(ymin + (ymax - ymin) * f)} y2={sy(ymin + (ymax - ymin) * f)} />
            <text x={L - 6} y={sy(ymin + (ymax - ymin) * f) + 4} textAnchor="end" style={{ fontSize: 10.5 }}>{yFormat(ymin + (ymax - ymin) * f)}</text>
            <text x={sx(xmin + (xmax - xmin) * f)} y={H - B + 16} textAnchor="middle" style={{ fontSize: 10.5 }}>{xFormat(xmin + (xmax - xmin) * f)}</text>
          </g>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="muted" style={{ fontSize: 11 }}>{xLabel}</text>
        <text x={12} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`} style={{ fontSize: 11 }}>{yLabel}</text>
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={p.ring ? 7 : 5.5} fill={condColor(p.condition)} opacity={0.8}
            stroke={p.ring ? "var(--ink)" : "var(--bg)"} strokeWidth={p.ring ? 2 : 1.2}
            onPointerMove={(e) => tip.show(e, <TipValue value={`${xFormat(p.x)} · ${yFormat(p.y)}`} label={p.label} />)} onPointerLeave={tip.hide} />
        ))}
      </svg>
      <div className="row wrap tiny muted" style={{ gap: 14 }}>
        <span>r = <strong style={{ color: "var(--ink)" }}>{r === null ? "—" : num(r, 2)}</strong> · n = {n}</span>
        {highlight && <span>{highlight}</span>}
        <span>Малые выборки: смотрите на направление, а не на значимость.</span>
      </div>
      {tip.node}
    </div>
  );
}
