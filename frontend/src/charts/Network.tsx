import { useId, useMemo, useState } from "react";
import { pct } from "../lib/format";
import { initials, personColor, shortName } from "../lib/people";
import type { Debrief } from "../lib/types";
import { Segmented } from "../ui/core";
import { TipValue, useTooltip } from "../ui/tooltip";

type Layer = "handover" | "help" | "kudos" | "mentions" | "asked_for_info" | "most_useful" | "actual_leader";

const LAYERS: { key: Layer; title: string; text: string }[] = [
  { key: "handover", title: "Передачи работы", text: "Кто кому передавал задачи. Размер узла — доля всех передач через участника." },
  { key: "help", title: "Помощь", text: "Кто кому приходил на помощь по сигналу «Нужна помощь»." },
  { key: "kudos", title: "Спасибо", text: "Кто кого благодарил. Сеть признания в команде." },
  { key: "mentions", title: "Эфир", text: "Кто кого упоминал в сообщениях." },
  { key: "asked_for_info", title: "За информацией", text: "К кому обращались за информацией (оценки коллег)." },
  { key: "actual_leader", title: "Кто руководил", text: "Кого коллеги назвали фактическим лидером. Совпадает ли он с формальной ролью?" },
];

/** Сети команды по кругу. Узел — участник его цветом, стрелка — связь выбранного слоя. */
export function Network({ data }: { data: Debrief }) {
  const tip = useTooltip();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [layer, setLayer] = useState<Layer>("handover");
  const W = 540, H = 440, cx = W / 2, cy = H / 2 + 4, R = 150;
  const people = data.people;
  const pos = useMemo(() => Object.fromEntries(people.map((p, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, people.length)) * Math.PI * 2;
    return [p.participant_id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a }];
  })), [people, cx, cy]);

  const edges = useMemo(() => {
    const acc: Record<string, { source: string; target: string; weight: number }> = {};
    const add = (s: string | null, t: string | null, w = 1) => {
      if (!s || !t || s === t) return;
      const k = `${s}>${t}`;
      acc[k] = acc[k] ? { ...acc[k], weight: acc[k].weight + w } : { source: s, target: t, weight: w };
    };
    if (layer === "handover") data.handover.forEach((e) => add(e.source, e.target, e.weight));
    else if (layer === "help") data.help.items.forEach((h) => add(h.helper_id, h.participant_id));
    else if (layer === "kudos") data.kudos.items.forEach((k) => add(k.from_participant, k.to_participant));
    else if (layer === "mentions") data.chat.mentions.forEach((m) => add(m.source, m.target, m.weight));
    else data.nominations.filter((n) => n.question === layer).forEach((n) => add(n.source, n.target));
    return Object.values(acc);
  }, [data, layer]);

  const received: Record<string, number> = {};
  const sent: Record<string, number> = {};
  edges.forEach((e) => {
    received[e.target] = (received[e.target] ?? 0) + e.weight;
    sent[e.source] = (sent[e.source] ?? 0) + e.weight;
  });
  const maxW = Math.max(1, ...edges.map((e) => e.weight));
  const size = (id: string) => {
    const p = people.find((x) => x.participant_id === id)!;
    const v = layer === "handover" ? p.load / Math.max(1e-9, ...people.map((x) => x.load)) : (received[id] ?? 0) / Math.max(1, ...Object.values(received));
    return 18 + (Number.isFinite(v) ? v : 0) * 20;
  };
  const current = LAYERS.find((l) => l.key === layer)!;

  if (!people.length) return <div className="empty"><div className="big">Нет участников</div></div>;

  return (
    <div className="chart stack">
      <Segmented items={LAYERS.map((l) => ({ key: l.key, title: l.title }))} value={layer} onChange={setLayer} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Сеть команды: ${current.title}`} style={{ maxWidth: 720, margin: "0 auto" }}>
        <defs>
          {people.map((p) => (
            <marker key={p.participant_id} id={`na-${uid}-${p.color_slot}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9"
              markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 1L10 5L0 9z" fill={personColor(p.color_slot)} />
            </marker>
          ))}
        </defs>
        {edges.length === 0 && <text x={cx} y={cy} textAnchor="middle" className="muted">В этом слое пока нет связей</text>}
        {edges.map((e) => {
          const a = pos[e.source], b = pos[e.target];
          if (!a || !b) return null;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const ra = size(e.source) + 3, rb = size(e.target) + 6;
          const x1 = a.x + (dx / len) * ra, y1 = a.y + (dy / len) * ra, x2 = b.x - (dx / len) * rb, y2 = b.y - (dy / len) * rb;
          const mx = (x1 + x2) / 2 - (dy / len) * 20, my = (y1 + y2) / 2 + (dx / len) * 20;
          const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
          const sp = people.find((p) => p.participant_id === e.source), tp = people.find((p) => p.participant_id === e.target);
          const content = <TipValue value={`${e.weight}`} label={`${shortName(sp)} → ${shortName(tp)}`} />;
          return (
            <g key={`${e.source}-${e.target}`}>
              <path d={d} fill="none" stroke={personColor(sp?.color_slot)} strokeOpacity={0.35 + 0.55 * (e.weight / maxW)}
                strokeWidth={1.2 + 4.5 * (e.weight / maxW)} markerEnd={`url(#na-${uid}-${sp?.color_slot ?? 1})`} />
              <path d={d} fill="none" stroke="transparent" strokeWidth={16} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide} />
            </g>
          );
        })}
        {people.map((p) => {
          const { x, y, a } = pos[p.participant_id];
          const r = size(p.participant_id);
          const lx = x + Math.cos(a) * (r + 12), ly = y + Math.sin(a) * (r + 12) - (Math.sin(a) < -0.3 ? 16 : 0);
          const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const content = (
            <div className="stack xs">
              <TipValue value={shortName(p)} label={`${p.role} · ${p.participant_id}`} />
              <div className="tl">Передач через участника: {pct(p.load)} · взял(а) {p.started} · сдал(а) {p.completed}</div>
              <div className="tl">Отправил(а) {sent[p.participant_id] ?? 0} · получил(а) {received[p.participant_id] ?? 0} в этом слое</div>
            </div>
          );
          return (
            <g key={p.participant_id} onPointerMove={(ev) => tip.show(ev, content)} onPointerLeave={tip.hide}>
              <circle cx={x} cy={y} r={r + 5} fill={personColor(p.color_slot)} opacity={0.18} />
              <circle cx={x} cy={y} r={r} fill={personColor(p.color_slot)} stroke="rgba(255,255,255,.35)" strokeWidth={1} />
              <text x={x} y={y + 4} textAnchor="middle" style={{ fontWeight: 700, fontSize: 12, fill: "#fff" }}>
                {initials({ display_name: p.display_name, role: p.role })}
              </text>
              <text x={lx} y={ly + (Math.sin(a) > 0.3 ? 10 : 0)} textAnchor={anchor} style={{ fontSize: 12 }}>
                <tspan className="label-strong">{shortName(p)}</tspan>
                <tspan x={lx} dy={14} style={{ fontSize: 11 }}>{p.role}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <p className="tiny muted">{current.text}</p>
      {tip.node}
    </div>
  );
}
