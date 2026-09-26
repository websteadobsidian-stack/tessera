import { useMemo, useState } from "react";
import { initials, pct } from "../format";
import type { Debrief } from "../types";
import { TipValue, useTooltip } from "./Tooltip";

const LAYERS: { key: string; title: string }[] = [
  { key: "handover", title: "Передачи работы" },
  { key: "asked_for_info", title: "К кому обращались" },
  { key: "most_useful", title: "Чей вклад полезен" },
  { key: "actual_leader", title: "Кто руководил" },
];

/** Сеть команды по кругу: узел — участник (размер — доля передач через него),
 *  стрелка — передача работы или оценка коллеги. */
export function Network({ data }: { data: Debrief }) {
  const tip = useTooltip();
  const [layer, setLayer] = useState("handover");
  const W = 520, H = 420, cx = W / 2, cy = H / 2 + 4, R = 136;
  const people = data.people;
  const pos = useMemo(() => Object.fromEntries(people.map((p, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, people.length)) * Math.PI * 2;
    return [p.participant_id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a }];
  })), [people, cx, cy]);

  const edges = layer === "handover"
    ? data.handover
    : Object.values(data.nominations.filter((n) => n.question === layer).reduce<Record<string, { source: string; target: string; weight: number }>>((m, n) => {
        const k = `${n.source}>${n.target}`;
        m[k] = m[k] ? { ...m[k], weight: m[k].weight + 1 } : { source: n.source, target: n.target, weight: 1 };
        return m;
      }, {}));
  const received: Record<string, number> = {};
  edges.forEach((e) => (received[e.target] = (received[e.target] ?? 0) + e.weight));
  const maxW = Math.max(1, ...edges.map((e) => e.weight));
  const maxRecv = Math.max(1, ...Object.values(received));
  const radius = (id: string) => {
    const p = people.find((x) => x.participant_id === id)!;
    const v = layer === "handover" ? p.load : (received[id] ?? 0) / maxRecv;
    return 17 + v * 22;
  };
  const top = Object.entries(layer === "handover" ? Object.fromEntries(people.map((p) => [p.participant_id, p.load])) : received)
    .sort((a, b) => b[1] - a[1])[0];

  if (!people.length) return <div className="empty"><div className="big">Нет участников</div></div>;

  return (
    <div className="chart">
      <div className="segmented" role="group" style={{ marginBottom: 10 }}>
        {LAYERS.map((l) => <button key={l.key} aria-pressed={layer === l.key} onClick={() => setLayer(l.key)}>{l.title}</button>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Сеть команды: ${LAYERS.find((l) => l.key === layer)?.title}`}>
        <defs>
          <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="var(--ink-2)" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = pos[e.source], b = pos[e.target];
          if (!a || !b) return null;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const ra = radius(e.source) + 3, rb = radius(e.target) + 6;
          const x1 = a.x + (dx / len) * ra, y1 = a.y + (dy / len) * ra, x2 = b.x - (dx / len) * rb, y2 = b.y - (dy / len) * rb;
          // Изгиб, чтобы встречные стрелки не совпадали.
          const mx = (x1 + x2) / 2 - (dy / len) * 18, my = (y1 + y2) / 2 + (dx / len) * 18;
          const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
          const sp = people.find((p) => p.participant_id === e.source), tp = people.find((p) => p.participant_id === e.target);
          const content = <TipValue value={`${e.weight}`} label={`${sp?.display_name || sp?.role} → ${tp?.display_name || tp?.role}`} />;
          return (
            <g key={`${e.source}-${e.target}`}>
              <path d={d} fill="none" stroke="var(--ink-2)" strokeOpacity={0.35 + 0.6 * (e.weight / maxW)}
                strokeWidth={1 + 4 * (e.weight / maxW)} markerEnd="url(#net-arrow)" />
              <path d={d} fill="none" stroke="transparent" strokeWidth={16}
                onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide} />
            </g>
          );
        })}
        {people.map((p) => {
          const { x, y, a } = pos[p.participant_id];
          const r = radius(p.participant_id);
          const isTop = top && top[0] === p.participant_id && top[1] > 0;
          const lx = x + Math.cos(a) * (r + 12), ly = y + Math.sin(a) * (r + 12) - (Math.sin(a) < -0.3 ? 16 : 0);
          const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const content = (
            <div className="stack sm">
              <TipValue value={p.display_name || p.role} label={`${p.role} · ${p.participant_id}`} />
              <div className="tl">Через него/неё {pct(p.load)} передач · взял(а) {p.started} · сдал(а) {p.completed}</div>
              {layer !== "handover" && <div className="tl">Выбрали коллеги: {received[p.participant_id] ?? 0}</div>}
            </div>
          );
          return (
            <g key={p.participant_id} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide}>
              <circle cx={x} cy={y} r={r} fill={isTop ? "var(--ink)" : "var(--surface)"} stroke="var(--ink)" strokeWidth={1.5} />
              <text x={x} y={y + 4} textAnchor="middle" style={{ fontWeight: 700, fontSize: 12, fill: isTop ? "var(--ink-inverse)" : "var(--ink)" }}>
                {initials({ display_name: p.display_name, role_title: p.role })}
              </text>
              <text x={lx} y={ly + (Math.sin(a) > 0.3 ? 10 : 0)} textAnchor={anchor} style={{ fontSize: 12 }}>
                <tspan className="label-strong">{p.display_name || p.participant_id}</tspan>
                <tspan x={lx} dy={14} style={{ fontSize: 11 }}>{p.role}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <p className="tiny muted">
        {layer === "handover" ? "Размер узла — доля всех передач работы через участника. Закрашен самый нагруженный узел."
          : "Размер узла — сколько раз коллеги выбрали участника. Сравните с сетью передач: совпадают ли неформальные лидеры с формальными ролями?"}
      </p>
      {tip.node}
    </div>
  );
}
