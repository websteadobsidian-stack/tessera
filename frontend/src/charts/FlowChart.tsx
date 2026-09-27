import { useMemo, useRef, useState } from "react";
import { BACKLOG, COLUMNS, STAGES, num, stageColor } from "../lib/format";
import type { Debrief, TimelineItem } from "../lib/types";
import { layoutMarks } from "./marks";

/** Накопительная диаграмма потока: сколько задач на каждом этапе в каждый момент.
 *  Снизу — сданные, сверху — бэклог. Пунктиры — вмешательства (вбросы, тишина, выезд…). */
export function FlowChart({ flow, timeline }: { flow: Debrief["flow"]; timeline: TimelineItem[] }) {
  const W = 980, L = 36, R = 150, B = 32;
  const maxMinute = Math.max(1, flow[flow.length - 1]?.minute ?? 1);
  const laid = useMemo(() => layoutMarks(
    timeline.filter((t) => t.minute !== null && t.minute >= 0 && t.minute <= maxMinute)
      .map((t) => ({ ...t, x: L + ((t.minute as number) / maxMinute) * (W - L - R) })),
    { maxRows: 3, charW: 6.1 }), [timeline, maxMinute]);
  const T = 18 + laid.rows * 13;
  const H = 280 + T;
  const order = useMemo(() => [...[...STAGES].reverse(), BACKLOG] as string[], []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const maxX = Math.max(1, flow[flow.length - 1]?.minute ?? 1);
    const maxY = Math.max(1, ...flow.map((p) => COLUMNS.reduce((s, c) => s + (p[c] ?? 0), 0)));
    const xs = flow.map((p) => L + (p.minute / maxX) * (W - L - R));
    const y = (v: number) => H - B - (v / maxY) * (H - T - B);
    const bands = order.map((stage, k) => {
      const lower = flow.map((p) => order.slice(0, k).reduce((s, c) => s + (p[c] ?? 0), 0));
      const upper = flow.map((p, i) => lower[i] + (p[stage] ?? 0));
      // Ступенчатые линии: задачи меняют этап скачком.
      const pts = (vals: number[]) => vals.flatMap((v, i) => i === 0 ? [[xs[i], y(v)]] : [[xs[i], y(vals[i - 1])], [xs[i], y(v)]]);
      const top = pts(upper);
      const bottom = pts(lower).reverse();
      const last = flow.length - 1;
      return {
        stage, d: `M${top.map((p) => p.join(",")).join("L")}L${bottom.map((p) => p.join(",")).join("L")}Z`,
        line: `M${top.map((p) => p.join(",")).join("L")}`,
        labelY: last >= 0 ? (y(lower[last]) + y(upper[last])) / 2 : 0, thick: last >= 0 ? (flow[last][stage] ?? 0) : 0,
      };
    });
    return { maxX, maxY, xs, y, bands };
  }, [flow, order, T, H]);

  if (flow.length < 2) return <div className="empty"><div className="big">Поток появится после начала работы</div></div>;
  const { maxX, maxY, xs, y, bands } = geo;

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    setHover(best);
  };
  const ticks = Array.from({ length: 6 }, (_, i) => (maxX / 5) * i);
  const p = hover !== null ? flow[hover] : null;
  const labels = bands.filter((b) => b.thick > 0).map((b) => ({ ...b, ly: b.labelY }));
  for (let i = 1; i < labels.length; i++) if (labels[i - 1].ly - labels[i].ly < 15) labels[i].ly = labels[i - 1].ly - 15;

  return (
    <div className="chart">
      <div className="legend">
        {COLUMNS.map((c) => <span key={c}><span className="swatch" style={{ background: stageColor(c) }} />{c}</span>)}
        <span><span className="key-line" style={{ width: 14, background: "var(--ink)", height: 2 }} />вмешательство</span>
      </div>
      <div className="chart-scroll">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Накопительная диаграмма потока задач"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line className="grid-line" x1={L} x2={W - R} y1={y(maxY * f)} y2={y(maxY * f)} />
              <text x={L - 8} y={y(maxY * f) + 4} textAnchor="end">{Math.round(maxY * f)}</text>
            </g>
          ))}
          {bands.map((b) => (
            <g key={b.stage}>
              <path d={b.d} fill={stageColor(b.stage)} opacity={b.stage === BACKLOG ? 0.55 : 0.92} />
              <path d={b.line} fill="none" stroke="var(--bg)" strokeWidth={2} />
            </g>
          ))}
          <line className="axis-line" x1={L} x2={W - R} y1={H - B} y2={H - B} />
          {ticks.map((t, i) => (
            <text key={i} x={L + (t / maxX) * (W - L - R)} y={H - B + 19} textAnchor="middle">{`${maxX < 10 ? num(t, 1) : Math.round(t)} мин`}</text>
          ))}
          {labels.map((b) => (
            <text key={b.stage} x={W - R + 10} y={b.ly + 4} style={{ fontSize: 12 }}>
              <tspan className="label-strong">{flow[flow.length - 1][b.stage]}</tspan> {b.stage}
            </text>
          ))}
          {laid.marks.map((m, k) => (
            <g key={k}>
              <title>{`${m.title} · ${num(m.minute)} мин`}</title>
              <line x1={m.x} x2={m.x} y1={m.row >= 0 ? 12 + m.row * 13 : T - 6} y2={H - B} stroke="var(--ink)" strokeDasharray="3 4" strokeWidth={1.1} opacity={0.7} />
              {m.label && <text x={m.x + 4} y={10 + m.row * 13 + 9} className="label-strong" style={{ fontSize: 10.5 }}>{m.label}</text>}
            </g>
          ))}
          {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth={1} />}
        </svg>
      </div>
      {p && (
        <div className="tooltip" style={{ position: "absolute", left: `min(calc(${(xs[hover!] / W) * 100}% + 12px), calc(100% - 210px))`, top: 44, transform: "none" }}>
          <div className="tl" style={{ marginBottom: 4 }}>{num(p.minute)} мин от старта</div>
          {COLUMNS.map((c) => (
            <div key={c} className="trow"><span className="row tight"><span className="key-line" style={{ background: stageColor(c) }} />{c}</span><strong>{p[c] ?? 0}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
