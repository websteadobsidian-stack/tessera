import { useMemo, useRef, useState } from "react";
import { BACKLOG, COLUMNS, STAGES, num, stageColor } from "../format";
import type { Debrief } from "../types";

/** Накопительная диаграмма потока: сколько задач на каждом этапе в каждую минуту.
 *  Снизу — сданные, сверху — бэклог. Молнии — вбросы ведущего. */
export function FlowChart({ flow, injects }: { flow: Debrief["flow"]; injects: Debrief["injects"] }) {
  const W = 960, H = 300, L = 36, R = 132, T = 26, B = 30;
  const order: string[] = [...[...STAGES].reverse(), BACKLOG]; // снизу вверх: Сдача … Анализ, Бэклог
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { xs, maxX, maxY, bands } = useMemo(() => {
    const maxX = Math.max(1, flow[flow.length - 1]?.minute ?? 1);
    const maxY = Math.max(1, ...flow.map((p) => COLUMNS.reduce((s, c) => s + (p[c] ?? 0), 0)));
    const xs = flow.map((p) => L + (p.minute / maxX) * (W - L - R));
    const y = (v: number) => H - B - (v / maxY) * (H - T - B);
    const bands = order.map((stage, k) => {
      const lower = flow.map((p) => order.slice(0, k).reduce((s, c) => s + (p[c] ?? 0), 0));
      const upper = flow.map((p, i) => lower[i] + (p[stage] ?? 0));
      const top = upper.map((v, i) => `${xs[i]},${y(v)}`);
      const bottom = lower.map((v, i) => `${xs[i]},${y(v)}`).reverse();
      const last = flow.length - 1;
      return { stage, d: `M${top.join("L")}L${bottom.join("L")}Z`, line: `M${top.join("L")}`,
        labelY: last >= 0 ? (y(lower[last]) + y(upper[last])) / 2 : 0, thick: last >= 0 ? (flow[last][stage] ?? 0) : 0 };
    });
    return { xs, maxX, maxY, bands };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  if (flow.length < 2) return <div className="empty"><div className="big">Поток появится после начала работы</div></div>;

  const y = (v: number) => H - B - (v / maxY) * (H - T - B);
  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    setHover(best);
  };
  const ticks = Array.from({ length: 6 }, (_, i) => (maxX / 5) * i);
  const tickLabel = (t: number) => `${maxX < 10 ? num(t, 1) : Math.round(t)} мин`;
  const p = hover !== null ? flow[hover] : null;
  const tipLeft = hover !== null ? (xs[hover] / W) * 100 : 0;
  // Подписи бэндов справа: раздвигаем, чтобы не наезжали друг на друга.
  const labels = bands.filter((b) => b.thick > 0).map((b) => ({ ...b, ly: b.labelY }));
  for (let i = 1; i < labels.length; i++) if (labels[i - 1].ly - labels[i].ly < 14) labels[i].ly = labels[i - 1].ly - 14;

  return (
    <div className="chart">
      <div className="legend">
        {COLUMNS.map((c) => <span key={c}><span className="swatch" style={{ background: stageColor(c) }} />{c}</span>)}
      </div>
      <div className="chart-scroll"><svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Накопительная диаграмма потока задач"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].filter((f) => Number.isInteger(maxY * f) || f === 1).map((f) => (
          <g key={f}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(maxY * f)} y2={y(maxY * f)} />
            <text x={L - 8} y={y(maxY * f) + 4} textAnchor="end">{Math.round(maxY * f)}</text>
          </g>
        ))}
        {bands.map((b) => (
          <g key={b.stage}>
            <path d={b.d} fill={stageColor(b.stage)} opacity={b.stage === BACKLOG ? 0.35 : 0.88} />
            <path d={b.line} fill="none" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
        <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        {ticks.map((t, i) => (
          <text key={i} x={L + (t / maxX) * (W - L - R)} y={H - B + 18} textAnchor="middle">{tickLabel(t)}</text>
        ))}
        {labels.map((b) => (
          <text key={b.stage} x={W - R + 8} y={b.ly + 4} style={{ fontSize: 12 }}>
            <tspan className="label-strong">{flow[flow.length - 1][b.stage]}</tspan> {b.stage}
          </text>
        ))}
        {injects.filter((i) => i.minute !== null && i.minute >= 0 && i.minute <= maxX).map((i, k) => {
          const ix = L + ((i.minute as number) / maxX) * (W - L - R);
          return (
            <g key={k}>
              <line x1={ix} x2={ix} y1={T - 8} y2={H - B} stroke="var(--ink)" strokeDasharray="3 4" strokeWidth={1.2} />
              <text x={ix + 4} y={T - 10 + (k % 2) * 13} className="label-strong" style={{ fontSize: 11 }}>⚡ {i.title}</text>
            </g>
          );
        })}
        {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth={1} />}
      </svg></div>
      {p && (
        <div className="tooltip" style={{ position: "absolute", left: `min(calc(${tipLeft}% + 12px), calc(100% - 200px))`, top: 40, transform: "none" }}>
          <div className="tl" style={{ marginBottom: 4 }}>{num(p.minute)} мин от старта</div>
          {[...COLUMNS].map((c) => (
            <div key={c} className="trow"><span className="row" style={{ gap: 6 }}><span className="key-line" style={{ background: stageColor(c) }} />{c}</span>
              <strong>{p[c] ?? 0}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
