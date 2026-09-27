import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ArrowRightLeft, Car, Lightbulb, Plus, Radar, Trash, VolumeX, Zap, type LucideIcon } from "lucide-react";
import { num } from "../lib/format";
import type { Catalog, Protocol } from "../lib/types";
import { NumberField } from "../ui/fields";
import { Select } from "../ui/select";

export type Item = Protocol["config"]["timeline"][number];

export const KIND_META: Record<string, { icon: LucideIcon; color: string; title: string; timed?: boolean }> = {
  inject: { icon: Zap, color: "var(--warn)", title: "Вброс" },
  probe: { icon: Radar, color: "var(--accent)", title: "Синхрон" },
  silence: { icon: VolumeX, color: "var(--p1)", title: "Тишина", timed: true },
  blind_spot: { icon: Car, color: "var(--p5)", title: "Выезд", timed: true },
  role_swap: { icon: ArrowRightLeft, color: "var(--p3)", title: "Смена ролей", timed: true },
  nudge: { icon: Lightbulb, color: "var(--p4)", title: "Подсказка" },
};
const KINDS = Object.keys(KIND_META);

/** Мини-таймлайн протокола для карточек и списков. */
export function MiniTimeline({ config }: { config: Protocol["config"] }) {
  return (
    <span className="mini-tl" aria-hidden>
      {config.timeline.map((it, i) => (
        <span key={i} style={{ left: `${(it.minute / config.work_minutes) * 100}%`, background: KIND_META[it.kind]?.color ?? "var(--ink-3)" }} />
      ))}
    </span>
  );
}

function summary(it: Item, catalog: Catalog): string {
  if (it.kind === "inject") return catalog.injects.find((x) => x.key === it.key)?.title ?? "Вброс";
  if (it.kind === "probe") return catalog.probes.find((x) => x.key === it.key)?.question ?? "Синхрон";
  if (it.kind === "nudge") return it.text?.trim() || "Текст подсказки не задан";
  if (it.kind === "blind_spot") {
    const who = it.target === "random" ? "случайный участник" : it.target && it.target !== "busiest"
      ? `роль «${catalog.roles.find((r) => r.slug === it.target)?.title ?? it.target}»` : "самый загруженный";
    return `${who} · ${num(it.minutes ?? 4)} мин`;
  }
  return `${num(it.minutes ?? 4)} мин`;
}

function defaults(kind: string, catalog: Catalog): Partial<Item> {
  return {
    key: kind === "inject" ? catalog.injects[0]?.key : kind === "probe" ? catalog.probes[0]?.key : undefined,
    minutes: KIND_META[kind]?.timed ? 4 : undefined,
    target: kind === "blind_spot" ? "busiest" : undefined,
    text: kind === "nudge" ? "" : undefined,
  };
}

/** Визуальный редактор таймлайна: события — плитки на шкале, их можно тащить; внизу — карточка выбранного события. */
export function TimelineEditor({ timeline, workMinutes, catalog, readOnly, onChange }: {
  timeline: Item[]; workMinutes: number; catalog: Catalog; readOnly: boolean; onChange: (t: Item[]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(timeline.length ? 0 : null);
  const [drag, setDrag] = useState<{ i: number; moved: boolean } | null>(null);
  const W = Math.max(1, workMinutes);

  // Раскладка по дорожкам: близкие по времени события не перекрываются.
  const lanes = useMemo(() => {
    const order = timeline.map((it, i) => ({ i, m: it.minute })).sort((a, b) => a.m - b.m);
    const ends: number[] = [];
    const out: Record<number, number> = {};
    for (const { i, m } of order) {
      const pct = (m / W) * 100;
      let lane = ends.findIndex((e) => e <= pct);
      if (lane === -1) { lane = ends.length; ends.push(0); }
      ends[lane] = pct + 4.2;
      out[i] = Math.min(lane, 2);
    }
    return out;
  }, [timeline, W]);
  const laneCount = Math.max(1, ...Object.values(lanes).map((l) => l + 1));

  const set = (i: number, patch: Partial<Item>) => onChange(timeline.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const minuteAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const m = ((clientX - r.left) / r.width) * W;
    return Math.min(W, Math.max(0, Math.round(m * 2) / 2));
  };

  const onDown = (e: RPointerEvent, i: number) => {
    setSelected(i);
    if (readOnly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ i, moved: false });
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const m = minuteAt(e.clientX);
    if (m !== timeline[drag.i].minute) { set(drag.i, { minute: m }); if (!drag.moved) setDrag({ ...drag, moved: true }); }
  };
  const add = () => {
    const ms = [0, ...timeline.map((t) => t.minute).sort((a, b) => a - b), W];
    let best = [0, W];
    for (let k = 1; k < ms.length; k++) if (ms[k] - ms[k - 1] > best[1] - best[0]) best = [ms[k - 1], ms[k]];
    const minute = Math.round((best[0] + best[1])) / 2;
    const kind = "probe";
    onChange([...timeline, { minute, kind, ...defaults(kind, catalog) } as Item]);
    setSelected(timeline.length);
  };
  const remove = (i: number) => {
    onChange(timeline.filter((_, j) => j !== i));
    setSelected(null);
  };

  const ticks = Array.from({ length: Math.floor(W / 5) + 1 }, (_, k) => k * 5);
  const cur = selected !== null ? timeline[selected] : null;
  const sortedIdx = timeline.map((_, i) => i).sort((a, b) => timeline[a].minute - timeline[b].minute);

  return (
    <div className="stack lg">
      <div className="tlx" style={{ ["--lanes" as string]: laneCount }}>
        <div className="tlx-track" ref={trackRef} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <div className="tlx-rail" />
          {ticks.map((m) => (
            <span key={m} className={`tlx-tick ${m % 10 === 0 ? "major" : ""}`} style={{ left: `${(m / W) * 100}%` }}>
              {m % 10 === 0 && <b>{m}′</b>}
            </span>
          ))}
          {timeline.map((it, i) => {
            const meta = KIND_META[it.kind] ?? KIND_META.nudge;
            const Icon = meta.icon;
            const lane = lanes[i] ?? 0;
            const span = meta.timed ? ((it.minutes ?? 4) / W) * 100 : 0;
            return (
              <div key={i} className={`tlx-item ${selected === i ? "on" : ""} ${drag?.i === i ? "dragging" : ""}`}
                style={{ left: `${(it.minute / W) * 100}%`, top: 10 + lane * 44, ["--k" as string]: meta.color }}>
                {span > 0 && <span className="tlx-span" style={{ width: `${span}cqw` }} />}
                <button type="button" className="tlx-tile" aria-label={`${meta.title} на ${num(it.minute)}-й минуте`}
                  onPointerDown={(e) => onDown(e, i)}
                  onKeyDown={(e) => {
                    if (readOnly) return;
                    const d = e.key === "ArrowLeft" ? -0.5 : e.key === "ArrowRight" ? 0.5 : 0;
                    if (d) { e.preventDefault(); set(i, { minute: Math.min(W, Math.max(0, it.minute + d * (e.shiftKey ? 10 : 1))) }); }
                    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(i); }
                  }}>
                  <Icon size={15} />
                </button>
                <AnimatePresence>
                  {(drag?.i === i || selected === i) && (
                    <motion.span className="tlx-badge" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{num(it.minute)}′</motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
      {!readOnly && <span className="tiny muted">Тяните плитку по шкале, чтобы сдвинуть событие; ← → — на полминуты, Shift — на пять.</span>}

      <div className="tlx-body">
        <div className="tlx-list">
          {sortedIdx.map((i) => {
            const it = timeline[i];
            const meta = KIND_META[it.kind] ?? KIND_META.nudge;
            const Icon = meta.icon;
            return (
              <button key={i} type="button" className={`tlx-row ${selected === i ? "on" : ""}`} onClick={() => setSelected(i)} style={{ ["--k" as string]: meta.color }}>
                <span className="tlx-min mono">{num(it.minute)}′</span>
                <span className="tlx-ico"><Icon size={14} /></span>
                <span className="stack xs grow" style={{ gap: 0, minWidth: 0 }}>
                  <strong className="small">{meta.title}</strong>
                  <span className="tiny muted ellipsis">{summary(it, catalog)}</span>
                </span>
              </button>
            );
          })}
          {!readOnly && (
            <button type="button" className="tlx-row add" onClick={add}><Plus size={16} />Добавить событие</button>
          )}
          {timeline.length === 0 && readOnly && <p className="small muted">Без таймлайна: все вмешательства — вручную с пульта.</p>}
        </div>

        <AnimatePresence mode="wait">
          {cur && selected !== null ? (
            <motion.div key={selected} className="tlx-card" style={{ ["--k" as string]: (KIND_META[cur.kind] ?? KIND_META.nudge).color }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              <div className="row between wrap">
                <span className="eyebrow">Событие таймлайна</span>
                <div className="row tight">
                  <NumberField label="Минута" value={cur.minute} onChange={(v) => set(selected, { minute: v })} min={0} max={W} step={0.5} decimals={1}
                    suffix="мин" size="sm" disabled={readOnly} width={140} />
                  {!readOnly && <button className="btn ghost icon sm" aria-label="Удалить событие" title="Удалить" onClick={() => remove(selected)}><Trash size={15} /></button>}
                </div>
              </div>
              <div className="kind-palette" role="radiogroup" aria-label="Вид события">
                {KINDS.map((k) => {
                  const m = KIND_META[k];
                  const I = m.icon;
                  return (
                    <button key={k} type="button" role="radio" aria-checked={cur.kind === k} disabled={readOnly} className="kind-chip"
                      style={{ ["--k" as string]: m.color }} onClick={() => set(selected, { kind: k, ...defaults(k, catalog) })}>
                      <span className="kind-ico"><I size={16} /></span>{m.title}
                    </button>
                  );
                })}
              </div>
              <p className="small soft">{catalog.interventions.find((x) => x.kind === cur.kind)?.text}</p>
              {cur.kind === "inject" && (
                <Select label="Какой вброс" value={cur.key ?? null} disabled={readOnly} showHint onChange={(v) => set(selected, { key: v })}
                  options={catalog.injects.map((x) => ({ value: x.key, label: x.title, hint: x.hint, icon: <Zap size={16} color="var(--warn)" /> }))} />
              )}
              {cur.kind === "probe" && (
                <Select label="Вопрос Синхрона" value={cur.key ?? null} disabled={readOnly} showHint menuWidth={420} onChange={(v) => set(selected, { key: v })}
                  options={catalog.probes.map((x) => ({ value: x.key, label: x.title, hint: x.question, text: `${x.title} ${x.question}`, icon: <Radar size={16} color="var(--accent)" /> }))} />
              )}
              {KIND_META[cur.kind]?.timed && (
                <div className="row wrap">
                  <span className="label">Длительность</span>
                  <NumberField label="Длительность" value={cur.minutes ?? 4} onChange={(v) => set(selected, { minutes: v })} min={0.5} max={30} step={0.5} decimals={1}
                    suffix="мин" disabled={readOnly} width={150} />
                </div>
              )}
              {cur.kind === "blind_spot" && (
                <Select label="Кто уезжает" value={cur.target ?? "busiest"} disabled={readOnly} onChange={(v) => set(selected, { target: v })}
                  options={[
                    { value: "busiest", label: "Самый загруженный", hint: "у кого больше всего задач в работе" },
                    { value: "random", label: "Случайный участник" },
                    ...catalog.roles.map((r) => ({ value: r.slug, label: `Роль: ${r.title}`, group: "По роли" })),
                  ]} showHint />
              )}
              {cur.kind === "nudge" && (
                <textarea className="textarea" value={cur.text ?? ""} maxLength={300} disabled={readOnly} placeholder="Например: проверьте, всё ли выложено на стол"
                  onChange={(e) => set(selected, { text: e.target.value })} />
              )}
            </motion.div>
          ) : (
            <div className="tlx-card empty-card"><span className="small muted">Выберите событие на шкале или в списке.</span></div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
