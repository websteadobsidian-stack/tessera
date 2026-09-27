import { CircleCheck, CircleX } from "lucide-react";
import { num, pct, STAGES } from "../lib/format";
import { capitalize, personColor, shortName } from "../lib/people";
import type { Debrief, DebriefPerson, Synergy, TimelineItem } from "../lib/types";
import { AnimatedNumber, PersonTile, WeatherIcon } from "../ui/core";
import { TipValue, useTooltip } from "../ui/tooltip";
import { layoutMarks } from "./marks";

/* ------------------------------------------------------------------ сыгранность */

export function SynergyCard({ synergy, compact }: { synergy: Synergy; compact?: boolean }) {
  return (
    <div className="stack">
      <div className="synergy">
        <div className="score"><AnimatedNumber value={synergy.score} /></div>
        <div className="stack xs grow">
          <span className="eyebrow">Сыгранность · уровень {synergy.level.index + 1} из 5</span>
          <span className="level">{synergy.level.title}</span>
          <span className="tiny muted">{synergy.level.text}</span>
        </div>
      </div>
      <div className="level-steps">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className={i <= synergy.level.index ? "on" : ""} />)}
      </div>
      {!compact && (
        <div className="stack sm" style={{ marginTop: 4 }}>
          {synergy.components.map((c) => (
            <div key={c.key} className="component-row" title={c.hint}>
              <span className="soft">{c.title}</span>
              <div className="bar accent"><span style={{ width: `${(c.value ?? 0) * 100}%`, opacity: c.value === null ? 0 : 1 }} /></div>
              <span className="mono tiny" style={{ textAlign: "right" }}>{c.value === null ? "—" : Math.round(c.value * 100)}</span>
            </div>
          ))}
          <span className="tiny muted">Индекс описывает взаимодействие, а не оценивает людей. Компоненты без данных не учитываются.</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ скрытый профиль */

export function HiddenProfile({ data }: { data: Debrief }) {
  const tip = useTooltip();
  const pool = data.pooling;
  const people = Object.fromEntries(data.people.map((p) => [p.participant_id, p]));
  const options = pool.decision.options;
  const maxMinute = Math.max(data.work_minutes || 50, ...pool.facts.map((f) => f.minute ?? 0), pool.decision.minute ?? 0);
  const W = 720, rowH = 30, L = 196, T = 20;
  const roles = Array.from(new Set(data.people.map((p) => p.role_slug)));
  const H = T + roles.length * rowH + 34;
  const x = (m: number) => L + (m / maxMinute) * (W - L - 20);
  const preCounts: Record<string, number> = {};
  pool.pre.forEach((p) => { preCounts[p.option] = (preCounts[p.option] ?? 0) + 1; });

  return (
    <div className="stack lg">
      <div className="grid-3">
        <div className="stat"><div className="k">Ключевых фактов на столе</div>
          <div className="v">{pool.key_shared}<small>из {pool.key_total}</small></div>
          <div className="d">до решения — {pool.key_before_decision}</div></div>
        <div className="stat"><div className="k">До обсуждения лучший вариант видели</div>
          <div className="v">{pool.pre.filter((p) => p.option === pool.decision.correct).length}<small>из {pool.pre.length}</small></div>
          <div className="d">личный выбор на брифинге</div></div>
        <div className="stat"><div className="k">Решение команды</div>
          <div className="v" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {pool.decision.chosen ?? "—"}
            {pool.decision.is_correct === true && <CircleCheck size={24} color="var(--good)" />}
            {pool.decision.is_correct === false && <CircleX size={24} color="var(--bad)" />}
          </div>
          <div className="d">{pool.decision.is_correct === null ? "не принято" : pool.decision.is_correct ? "картина сложилась" : `лучший вариант — ${pool.decision.correct}`}</div></div>
      </div>

      <div className="chart">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Когда факты попадали на стол</div>
        <div className="chart-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Факты на общем столе по времени">
            {roles.map((r, i) => {
              const person = data.people.find((p) => p.role_slug === r);
              return (
                <g key={r}>
                  <line className="grid-line" x1={L} x2={W - 20} y1={T + i * rowH + rowH / 2} y2={T + i * rowH + rowH / 2} />
                  <rect x={8} y={T + i * rowH + 7} width={14} height={14} rx={4} fill={personColor(person?.color_slot)} />
                  <text x={30} y={T + i * rowH + rowH / 2 + 4}>{capitalize(person?.role ?? r)}</text>
                </g>
              );
            })}
            {pool.decision.minute !== null && (
              <g>
                <line x1={x(pool.decision.minute)} x2={x(pool.decision.minute)} y1={T - 8} y2={H - 26} stroke="var(--accent)" strokeWidth={2} />
                <text x={x(pool.decision.minute) + 6} y={T - 4} style={{ fill: "var(--accent)", fontWeight: 700, fontSize: 11 }}>решение: {pool.decision.chosen}</text>
              </g>
            )}
            {pool.facts.map((f) => {
              const i = roles.indexOf(f.role);
              const cy = T + i * rowH + rowH / 2;
              const cx = x(f.minute ?? 0);
              const owner = people[f.owner];
              return (
                <g key={f.fact_id} onPointerMove={(e) => tip.show(e, <TipValue value={f.key ? "Ключевой факт" : "Факт"} label={<>{f.text}<br />{num(f.minute)} мин</>} />)}
                  onPointerLeave={tip.hide}>
                  {f.key
                    ? <rect x={cx - 7} y={cy - 7} width={14} height={14} fill={personColor(owner?.color_slot)} transform={`rotate(45 ${cx} ${cy})`} stroke="var(--bg)" strokeWidth={2} />
                    : <circle cx={cx} cy={cy} r={6} fill={personColor(owner?.color_slot)} stroke="var(--bg)" strokeWidth={2} opacity={0.75} />}
                </g>
              );
            })}
            <line className="axis-line" x1={L} x2={W - 20} y1={H - 26} y2={H - 26} />
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <text key={f} x={x(maxMinute * f)} y={H - 8} textAnchor="middle">{Math.round(maxMinute * f)} мин</text>
            ))}
          </svg>
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="var(--ink-2)" /></svg>ключевой факт</span>
          <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="var(--ink-2)" /></svg>дополнительный</span>
        </div>
      </div>

      <div className="stack sm">
        <div className="eyebrow">От личного выбора к решению команды</div>
        <div className="row wrap" style={{ gap: 18, alignItems: "stretch" }}>
          <div className="stack sm grow" style={{ minWidth: 240 }}>
            {options.map((o) => {
              const voters = pool.pre.filter((p) => p.option === o.id);
              return (
                <div key={o.id} className="row" style={{ gap: 10 }}>
                  <span className="tile sm" style={{ ["--c" as string]: o.id === pool.decision.correct ? "var(--good)" : "var(--ink-3)" }}>{o.id}</span>
                  <span className="soft small ellipsis" style={{ width: 150 }}>{o.title}</span>
                  <div className="row tight wrap">
                    {voters.map((v) => <PersonTile key={v.participant_id} person={{ ...people[v.participant_id], role_title: people[v.participant_id]?.role }} size="xs"
                      title={`${shortName(people[v.participant_id])}: уверенность ${v.confidence}/5`} />)}
                    {!voters.length && <span className="tiny muted">никто</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel pad-sm flat" style={{ minWidth: 220, maxWidth: 380 }}>
            <p className="small soft">{pool.decision.explanation}</p>
          </div>
        </div>
      </div>
      {tip.node}
    </div>
  );
}

/* ------------------------------------------------------------------ прогноз и синхрон */

export function ForecastChart({ data }: { data: Debrief }) {
  const f = data.forecast;
  const people = Object.fromEntries(data.people.map((p) => [p.participant_id, p]));
  const total = Math.max(data.tasks.length, f.actual_tasks, ...f.people.map((p) => p.tasks_done));
  if (!f.people.length) return <p className="small muted">Прогнозов не было.</p>;
  const x = (v: number) => `${(v / Math.max(1, total)) * 100}%`;
  return (
    <div className="stack">
      <div style={{ position: "relative", height: 70, margin: "10px 12px 0" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 32, height: 6, borderRadius: 4, background: "var(--glass-3)" }} />
        {f.people.map((p, i) => (
          <div key={p.participant_id} style={{ position: "absolute", left: x(p.tasks_done), top: 22 - (i % 3) * 11, transform: "translateX(-50%)" }}>
            <PersonTile person={{ ...people[p.participant_id], role_title: people[p.participant_id]?.role }} size="xs"
              title={`${shortName(people[p.participant_id])}: ${p.tasks_done}`} />
          </div>
        ))}
        <div style={{ position: "absolute", left: x(f.actual_tasks), top: 12, bottom: 0, width: 3, borderRadius: 2, background: "var(--accent)", transform: "translateX(-50%)" }} />
        <div className="tiny strong" style={{ position: "absolute", left: x(f.actual_tasks), top: 52, transform: "translateX(-50%)", color: "var(--accent)", whiteSpace: "nowrap" }}>
          сдали {f.actual_tasks}
        </div>
      </div>
      <div className="row wrap small soft" style={{ gap: 18 }}>
        <span>Средний прогноз: <strong>{num(f.mean_prediction)}</strong></span>
        <span>Ошибка: <strong>{num(f.error)}</strong> задач</span>
        <span>Разброс ожиданий: <strong>{num(f.spread)}</strong></span>
        <span>M-1 в срок: предсказали верно <strong>{pct(f.m1_accuracy)}</strong></span>
      </div>
    </div>
  );
}

export function ProbeResults({ data }: { data: Debrief }) {
  const items = data.probes.items;
  if (!items.length) return <p className="small muted">Синхронов не было.</p>;
  return (
    <div className="stack">
      {items.map((p) => {
        const total = Math.max(1, p.answered);
        return (
          <div key={p.probe_id} className="stack sm">
            <div className="row between wrap">
              <span className="strong small">{p.question}</span>
              <span className="row tight tiny muted">
                {p.minute !== null && <span>{num(p.minute)} мин ·</span>}
                совпадение <strong style={{ color: "var(--ink)" }}>{pct(p.alignment)}</strong>
                {p.accuracy !== null && <> · верно {pct(p.accuracy)}</>}
              </span>
            </div>
            <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden", gap: 2 }}>
              {p.options.filter((o) => p.counts[o.id]).map((o) => (
                <div key={o.id} title={`${o.title}: ${p.counts[o.id]}`}
                  style={{ flex: p.counts[o.id] / total, background: o.id === p.truth ? "var(--good)" : "var(--st-3)",
                    display: "flex", alignItems: "center", padding: "0 8px", fontSize: 11.5, fontWeight: 650, color: "#fff", minWidth: 0 }}>
                  <span className="ellipsis">{o.title} · {p.counts[o.id]}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <span className="tiny muted">Зелёным — верный ответ, если он есть. Совпадение — доля ответивших, как большинство.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ погода во времени */

export function WeatherTimeline({ data }: { data: Debrief }) {
  const tip = useTooltip();
  const points = data.weather.points.filter((p) => p.minute !== null);
  if (!points.length) return <p className="small muted">Погоду не отмечали.</p>;
  const maxMinute = Math.max(data.work_minutes || 50, ...points.map((p) => p.minute as number));
  const minMinute = Math.min(0, ...points.map((p) => p.minute as number));
  const W = 720, L = 150, rowH = 34;
  const x = (m: number) => L + ((m - minMinute) / (maxMinute - minMinute || 1)) * (W - L - 24);
  const laid = layoutMarks(data.timeline.filter((t) => t.minute !== null).map((t) => ({ ...t, x: x(t.minute!) })), { maxRows: 3, charW: 5.6 });
  const T = 14 + laid.rows * 12;
  const H = T + data.people.length * rowH + 30;
  return (
    <div className="chart">
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Погода участников по ходу сессии">
          {laid.marks.map((t, i) => (
            <g key={i}>
              <title>{t.title}</title>
              <line x1={t.x} x2={t.x} y1={t.row >= 0 ? 8 + t.row * 12 : T - 4} y2={H - 24} stroke="var(--ink-3)" strokeDasharray="3 4" />
              {t.label && <text x={t.x + 3} y={8 + t.row * 12 + 8} style={{ fontSize: 10 }}>{t.label}</text>}
            </g>
          ))}
          {data.people.map((p, i) => {
            const mine = points.filter((w) => w.participant_id === p.participant_id);
            const cy = T + i * rowH + rowH / 2;
            return (
              <g key={p.participant_id}>
                <rect x={8} y={cy - 7} width={14} height={14} rx={4} fill={personColor(p.color_slot)} />
                <text x={30} y={cy + 4}>{shortName(p)}</text>
                {mine.map((w, k) => {
                  const next = mine[k + 1];
                  const x1 = x(w.minute!), x2 = next ? x(next.minute!) : W - 24;
                  const tone = w.value >= 4 ? "var(--warn)" : w.value === 3 ? "var(--ink-3)" : w.value === 2 ? "var(--p1)" : "var(--accent)";
                  return (
                    <g key={k} onPointerMove={(e) => tip.show(e, <TipValue value={["", "Буря", "Тяжело", "Переменно", "Ясно"][w.value]} label={`${shortName(p)} · ${num(w.minute)} мин`} />)}
                      onPointerLeave={tip.hide}>
                      <rect x={x1} y={cy - 5} width={Math.max(2, x2 - x1 - 2)} height={10} rx={5} fill={tone} opacity={0.85} />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend" style={{ marginTop: 6 }}>
        {[4, 3, 2, 1].map((v) => <span key={v}><WeatherIcon value={v} size={14} />{["", "буря", "тяжело", "переменно", "ясно"][v]}</span>)}
      </div>
      {tip.node}
    </div>
  );
}

/* ------------------------------------------------------------------ вклад и равномерность */

export function Contribution({ people, gini }: { people: DebriefPerson[]; gini: number }) {
  const max = Math.max(1, ...people.map((p) => p.actions));
  return (
    <div className="stack">
      <div className="stack sm">
        {[...people].sort((a, b) => b.actions - a.actions).map((p) => (
          <div key={p.participant_id} className="row" style={{ gap: 10 }}>
            <PersonTile person={{ ...p, role_title: p.role }} size="sm" />
            <span className="small ellipsis" style={{ width: 110 }}>{shortName(p)}</span>
            <div className="grow" style={{ height: 12, background: "var(--glass-2)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${(p.actions / max) * 100}%`, height: "100%", borderRadius: 6, background: personColor(p.color_slot) }} />
            </div>
            <span className="mono tiny" style={{ width: 34, textAlign: "right" }}>{p.actions}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted">
        Равномерность участия: <strong style={{ color: "var(--ink)" }}>{Math.round((1 - gini) * 100)} из 100</strong>.
        Команды, где слово и работа распределены ровнее, обычно лучше решают сложные задачи.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ полосы */

export function HBars({ rows, unit }: { rows: { label: string; value: number; color?: string }[]; unit: string }) {
  const tip = useTooltip();
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="small muted">Нет данных.</p>;
  return (
    <div className="stack sm">
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ gap: 10 }}
          onPointerMove={(e) => tip.show(e, <TipValue value={`${num(r.value)} ${unit}`} label={r.label} />)} onPointerLeave={tip.hide}>
          <span className="small" style={{ width: 120, flex: "none" }}>{r.label}</span>
          <div className="grow" style={{ height: 14, background: "var(--glass-2)", borderRadius: 5 }}>
            <div style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0, height: "100%", background: r.color ?? "var(--st-4)", borderRadius: 5 }} />
          </div>
          <span className="small mono" style={{ width: 70, textAlign: "right" }}>{num(r.value)} {unit}</span>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

export function waitingRows(data: Debrief) {
  return STAGES.filter((s) => data.waiting_by_stage[s] !== undefined).map((s) => ({ label: s, value: data.waiting_by_stage[s] }));
}

export function TimelineList({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="small muted">Вмешательств не было.</p>;
  const source: Record<string, string> = { facilitator: "ведущий", schedule: "протокол", director: "режиссёр", system: "система" };
  return (
    <div className="stack sm">
      {items.map((t, i) => (
        <div key={i} className="row small" style={{ gap: 10 }}>
          <span className="mono tiny muted" style={{ width: 52 }}>{t.minute === null ? "—" : `${num(t.minute)}′`}</span>
          <span className="grow ellipsis">{t.title}</span>
          <span className="chip">{source[t.source] ?? t.source}</span>
        </div>
      ))}
    </div>
  );
}
