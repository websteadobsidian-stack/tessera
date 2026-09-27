import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  ArrowRightLeft, Ban, Car, CheckCircle2, CircleAlert, Clock, Eye, Lightbulb, Play, Radar, Send, Shuffle, Sparkles, Timer, Users, VolumeX, Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { ago, clock, num, SIGNAL_TONE } from "../lib/format";
import { byId, shortName, personColor } from "../lib/people";
import type { AdminLive, ScheduleItem, Signal } from "../lib/types";
import { Rich } from "../participant/Air";
import { Empty, KudosIcon, PersonTile, Segmented, WeatherIcon } from "../ui/core";
import { NumberField } from "../ui/fields";
import { NOBODY, personOptions } from "../ui/options";
import { useAction } from "../ui/overlays";
import { Select } from "../ui/select";
import { useFacilitator } from "./Shell";

export type Fire = (kind: string, payload?: Record<string, unknown>, ok?: string) => Promise<boolean>;

export function useFire(live: AdminLive, reload: () => Promise<void>) {
  const { token } = useFacilitator();
  const { run, busy } = useAction();
  const base = `/api/admin/sessions/${live.team.team_id}/${live.session.session_id}`;
  const fire: Fire = (kind, payload = {}, ok) =>
    run(async () => { await api(`${base}/interventions`, { method: "POST", token, body: { kind, ...payload } }); await reload(); }, ok);
  const post = (path: string, body?: unknown, ok?: string) =>
    run(async () => { await api(`${base}${path}`, { method: "POST", token, body: body ?? {} }); await reload(); }, ok);
  return { fire, post, busy, base };
}

/* ------------------------------------------------------------------ сигналы */

export function Signals({ live, fire, busy }: { live: AdminLive; fire: Fire; busy: boolean }) {
  const people = byId(live.roster);
  if (!live.signals.length) {
    return (
      <div className="signal calm">
        <CheckCircle2 size={18} color="var(--good)" />
        <div className="stack xs"><strong className="small">Всё спокойно</strong><span className="tiny muted">Система следит за застрявшими задачами, перегрузом и просьбами о помощи.</span></div>
      </div>
    );
  }
  return (
    <div className="stack sm">
      <AnimatePresence initial={false}>
        {live.signals.map((s: Signal) => {
          const who = s.participant_id ? people[s.participant_id] : null;
          return (
            <motion.div key={s.id} layout className={`signal ${SIGNAL_TONE[s.severity] ?? ""}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}>
              <CircleAlert size={17} className="sig-ico" />
              <div className="stack xs grow" style={{ minWidth: 0 }}>
                <strong className="small">{s.title}</strong>
                <span className="tiny soft">{s.text}</span>
                {who && <span className="row tight tiny muted"><PersonTile person={who} size="xs" />{shortName(who)}</span>}
              </div>
              {s.nudge && (
                <button className="btn xs" disabled={busy} title={`Отправить подсказку: «${s.nudge}»`}
                  onClick={() => fire("nudge", { text: s.nudge, participant_id: s.kind === "overloaded" ? null : s.participant_id ?? null }, "Подсказка отправлена")}>
                  <Lightbulb size={12} />Подсказать
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ вмешательства */

type IntKind = "inject" | "probe" | "silence" | "blind_spot" | "role_swap" | "nudge";

export function Interventions({ live, fire, busy }: { live: AdminLive; fire: Fire; busy: boolean }) {
  const [kind, setKind] = useState<IntKind>("inject");
  const scale = live.session.time_scale;
  const [minutes, setMinutes] = useState<number>(Math.max(0.5, Math.round(4 * scale * 2) / 2));
  const [target, setTarget] = useState("busiest");
  const [a, setA] = useState("auto");
  const [b, setB] = useState("auto");
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const working = live.session.phase === "work";
  const items: { key: IntKind; title: string; icon: typeof Zap }[] = [
    { key: "inject", title: "Вброс", icon: Zap },
    ...(live.mechanics.probes ? [{ key: "probe" as const, title: "Синхрон", icon: Radar }] : []),
    { key: "silence", title: "Тишина", icon: VolumeX },
    { key: "blind_spot", title: "Выезд", icon: Car },
    { key: "role_swap", title: "Роли", icon: ArrowRightLeft },
    { key: "nudge", title: "Подсказка", icon: Lightbulb },
  ];
  const Minutes = (
    <div className="field"><label>Длительность <span className="muted">(реальные минуты)</span></label>
      <div className="row wrap tight">
        {[0.5, 1, 2, 3, 5].map((m) => <button key={m} type="button" className="pill-toggle" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{num(m)} мин</button>)}
      </div></div>
  );
  return (
    <div className="stack">
      <div className="int-tabs">
        {items.map((it) => (
          <button key={it.key} aria-pressed={kind === it.key} onClick={() => setKind(it.key)}><it.icon size={16} /><span>{it.title}</span></button>
        ))}
      </div>
      {!working && kind !== "nudge" && <span className="tiny" style={{ color: "var(--warn)" }}>Эксперименты работают в рабочей фазе.</span>}

      {kind === "inject" && (
        <div className="stack sm">
          {live.injects.map((i) => (
            <div key={i.key} className="int-row">
              <div className="stack xs grow"><strong className="small">{i.title}</strong><span className="tiny muted">{i.hint}</span></div>
              <button className="btn sm" disabled={busy || !working} onClick={() => fire("inject", { key: i.key }, `Вброс: ${i.title}`)}><Zap size={13} />Запустить</button>
            </div>
          ))}
        </div>
      )}
      {kind === "probe" && (
        <div className="stack sm">
          {live.probe.open && <span className="chip accent">Идёт Синхрон: ответили {live.probe.open.answered} из {live.probe.open.team_size}</span>}
          {live.probes.map((p) => (
            <div key={p.key} className="int-row">
              <div className="stack xs grow"><strong className="small">{p.title}</strong><span className="tiny muted">{p.question}</span></div>
              <button className="btn sm" disabled={busy || !working || !!live.probe.open} onClick={() => fire("probe", { key: p.key }, "Синхрон запущен")}><Radar size={13} />Спросить</button>
            </div>
          ))}
        </div>
      )}
      {kind === "silence" && (
        <div className="stack">
          <p className="small soft">Команда не может говорить вслух — только Эфир. Проверяет письменную координацию; сообщения помечаются.</p>
          {Minutes}
          <button className="btn primary" disabled={busy || !working} onClick={() => fire("silence", { minutes }, "Тишина")}><VolumeX size={15} />Включить тишину</button>
        </div>
      )}
      {kind === "blind_spot" && (
        <div className="stack">
          <p className="small soft">Участник «уезжает к клиенту»: экран закрывается, действия недоступны. Кто подхватит его задачи?</p>
          <div className="field"><label>Кого</label>
            <Select label="Кого отправить" value={target} onChange={setTarget} showHint
              options={[
                { value: "busiest", label: "Самого загруженного", hint: "у кого больше всего задач в работе", icon: <Car size={16} color="var(--p5)" /> },
                { value: "random", label: "Случайного", icon: <Shuffle size={16} color="var(--ink-3)" /> },
                ...personOptions(live.roster).map((o) => ({ ...o, group: "Конкретного участника" })),
              ]} /></div>
          {Minutes}
          <button className="btn primary" disabled={busy || !working} onClick={() => fire("blind_spot", { target, minutes }, "Выезд")}><Car size={15} />Отправить на выезд</button>
        </div>
      )}
      {kind === "role_swap" && (
        <div className="stack">
          <p className="small soft">Двое меняются ролями и этапами (факты остаются при своих). Хорошо после первой вехи.</p>
          <div className="grid-2">
            {[{ v: a, set: setA, l: "Первый" }, { v: b, set: setB, l: "Второй" }].map((x) => (
              <div key={x.l} className="field"><label>{x.l}</label>
                <Select label={x.l} value={x.v} onChange={x.set}
                  options={[{ value: "auto", label: "Случайно", icon: <Shuffle size={16} color="var(--ink-3)" /> },
                    ...personOptions(live.roster.filter((p) => !p.orig_role_title))]} /></div>
            ))}
          </div>
          {Minutes}
          <button className="btn primary" disabled={busy || !working} onClick={() => fire("role_swap", { a: a === "auto" ? null : a, b: b === "auto" ? null : b, minutes }, "Смена ролей")}><ArrowRightLeft size={15} />Поменять</button>
        </div>
      )}
      {kind === "nudge" && (
        <div className="stack">
          <textarea className="textarea" style={{ minHeight: 80 }} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: у вас три задачи ждут контроля — кто поможет?" />
          <div className="row">
            <Select label="Кому" value={to || NOBODY} onChange={(v) => setTo(v === NOBODY ? "" : v)} style={{ flex: 1 }}
              options={[{ value: NOBODY, label: "Всей команде", icon: <Users size={16} color="var(--accent)" /> },
                ...personOptions(live.roster).map((o) => ({ ...o, group: "Одному участнику" }))]} />
            <button className="btn primary" disabled={busy || !text.trim()} onClick={async () => { if (await fire("nudge", { text: text.trim(), participant_id: to || null }, "Подсказка отправлена")) setText(""); }}><Send size={15} />Отправить</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ таймлайн протокола */

const KIND_ICON: Record<string, typeof Zap> = { inject: Zap, probe: Radar, silence: VolumeX, blind_spot: Car, role_swap: ArrowRightLeft, nudge: Lightbulb };

export function Schedule({ live, post, busy }: { live: AdminLive; post: (path: string, body?: unknown, ok?: string) => Promise<boolean>; busy: boolean }) {
  if (!live.schedule.length) return <p className="small muted">В протоколе этой сессии нет таймлайна. Вмешательства — вручную слева или в «Лаборатории».</p>;
  const scale = live.session.time_scale;
  return (
    <div className="schedule">
      {live.schedule.map((it: ScheduleItem) => {
        const Icon = KIND_ICON[it.kind] ?? Sparkles;
        const state = it.skipped ? "skipped" : it.error ? "error" : it.fired_at ? "fired" : (it.due_in ?? 99) < 1.5 * scale ? "soon" : "wait";
        return (
          <div key={it.item_id} className={`sched ${state}`}>
            <span className="sched-min mono">{num(it.minute / scale, 0)}′</span>
            <span className="sched-dot"><Icon size={13} /></span>
            <div className="stack xs grow" style={{ minWidth: 0 }}>
              <span className="small strong ellipsis">{it.title}</span>
              <span className="tiny muted">
                {state === "fired" ? `сработало в ${clock(it.fired_at)}` : state === "skipped" ? "пропущено" : state === "error" ? `не сработало: ${it.error}`
                  : it.due_in === null ? "после старта работы" : it.due_in <= 0 ? "сейчас" : `через ${num(it.due_in, 1)} мин`}
              </span>
            </div>
            {!it.fired_at && (
              <div className="row tight">
                <button className="btn xs" disabled={busy || live.session.phase !== "work"} title="Запустить сейчас" onClick={() => post(`/schedule/${it.item_id}/fire`, {}, "Запущено")}><Play size={12} /></button>
                <button className="btn xs ghost" disabled={busy} title="Пропустить" onClick={() => post(`/schedule/${it.item_id}/skip`, {}, "Пропущено")}><Ban size={12} /></button>
              </div>
            )}
          </div>
        );
      })}
      <span className="tiny muted">Минуты — логические (протокол × масштаб времени {num(scale, 2)}).</span>
    </div>
  );
}

/* ------------------------------------------------------------------ лента событий */

export function Feed({ live }: { live: AdminLive }) {
  const people = byId(live.roster);
  if (!live.feed.length) return <Empty title="Событий пока нет">Как только команда начнёт работать, здесь побегут действия.</Empty>;
  return (
    <div className="feed">
      {live.feed.slice(0, 40).map((e) => {
        const who = people[e.resource];
        return (
          <div key={e.event_id} className="feed-row">
            <PersonTile person={who} size="xs" />
            <span className="small grow ellipsis"><strong>{shortName(who)}</strong> <span className="soft">{e.activity}</span> <span className="mono tiny muted">{e.case_id}</span></span>
            <span className="tiny muted nowrap">{ago(e.ts, new Date(live.session.now).getTime())}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ люди */

export function PeoplePanel({ live }: { live: AdminLive }) {
  const phaseDone = (pid: string, phase: string) => (live.progress[pid] ?? []).some((x) => x.startsWith(`${phase}:`));
  const current = (pid: string) => live.tasks.filter((t) => t.assignee === pid && t.stage !== "Сдача");
  const surveyPhase = ["entry", "pulse", "exit"].includes(live.session.phase) ? live.session.phase : null;
  return (
    <div className="stack sm">
      {live.roster.length === 0 && <Empty title="Пока никого">Покажите код или QR — участники войдут с телефонов.</Empty>}
      {live.roster.map((p) => {
        const tasks = current(p.participant_id);
        return (
          <div key={p.participant_id} className="person-row" style={{ alignItems: "flex-start" }}>
            <PersonTile person={p} size="lg" online={p.online} muted={!!p.away_until} />
            <div className="stack xs grow" style={{ minWidth: 0 }}>
              <span className="row tight"><strong className="ellipsis">{shortName(p)}</strong>{p.is_bot && <span className="chip">бот</span>}
                {p.weather && <WeatherIcon value={p.weather} size={15} />}</span>
              <span className="tiny muted">{p.role_title}{p.orig_role_title ? ` (смена ролей, был(а) ${p.orig_role_title})` : ""} · {p.participant_id}</span>
              {p.away_until && <span className="chip warn" style={{ alignSelf: "flex-start" }}><Car size={11} />на выезде</span>}
              {tasks.length > 0 && <span className="tiny soft">{tasks.map((t) => `${t.key}${t.started ? "▶" : ""}`).join(" · ")}</span>}
            </div>
            {surveyPhase && (phaseDone(p.participant_id, surveyPhase) ? <span className="chip good">ответил(а)</span> : <span className="chip">заполняет</span>)}
          </div>
        );
      })}
      {live.pending_devices > 0 && <span className="tiny muted">Ещё {live.pending_devices} устройств вошли по коду, но не выбрали роль.</span>}
    </div>
  );
}

export function SocialPanel({ live }: { live: AdminLive }) {
  const people = byId(live.roster);
  const kinds = Object.fromEntries(live.scenario.kudos.map((k) => [k.id, k.title]));
  return (
    <div className="stack lg">
      {live.mechanics.help && (
        <div className="stack sm">
          <span className="eyebrow">Просьбы о помощи</span>
          {live.help.length === 0 && <span className="small muted">Пока никто не просил.</span>}
          {live.help.map((h) => {
            const who = people[h.participant_id], helper = h.helper_id ? people[h.helper_id] : null;
            return (
              <div key={h.help_id} className="kudos-row">
                <PersonTile person={who} size="sm" />
                <div className="stack xs grow"><span className="small"><strong>{shortName(who)}</strong>{h.case_key && <span className="mono muted"> · {h.case_key}</span>}{h.note && <span className="soft"> — {h.note}</span>}</span>
                  <span className="tiny muted">{h.resolved_at ? "закрыта" : helper ? `помогает ${shortName(helper)}` : "ждёт отклика"} · {ago(h.created_at)}</span></div>
              </div>
            );
          })}
        </div>
      )}
      {live.mechanics.kudos && (
        <div className="stack sm">
          <span className="eyebrow">Спасибо · {live.kudos.length}</span>
          {live.kudos.slice(0, 12).map((k) => (
            <div key={k.kudos_id} className="kudos-row">
              <span className="kudos-ico" style={{ color: personColor(people[k.to_participant]?.color_slot) }}><KudosIcon kind={k.kind} size={15} /></span>
              <span className="small grow"><strong>{shortName(people[k.from_participant])}</strong> → <strong>{shortName(people[k.to_participant])}</strong> <span className="muted">· {kinds[k.kind]}</span>{k.note && <span className="soft"> «{k.note}»</span>}</span>
            </div>
          ))}
        </div>
      )}
      {live.mechanics.weather && (
        <div className="stack sm">
          <span className="eyebrow">Погода</span>
          <div className="row wrap tight">
            {[4, 3, 2, 1].map((v) => <span key={v} className="chip lg"><WeatherIcon value={v} size={14} />{live.weather.counts[String(v)] ?? 0}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ стол и эфир */

export function TableAdmin({ live }: { live: AdminLive }) {
  const people = byId(live.roster);
  const t = live.table;
  const d = live.scenario.decision;
  const [show, setShow] = useState<"all" | "shared">("all");
  const facts = (t.all_facts ?? []).filter((f) => show === "all" || f.shared);
  return (
    <div className="stack lg">
      <div className="decision-head">
        <span className="eyebrow">Ключевое решение · верный ответ {d.correct}</span>
        <h3>{d.title}</h3>
        <span className="small soft">{d.explanation}</span>
      </div>
      {t.final ? (
        <div className={`final-card`} style={{ borderColor: t.final.is_correct ? "var(--good)" : "var(--bad)" }}>
          <span className="eyebrow">Решение команды</span>
          <strong>{t.final.chosen} — {d.options.find((o) => o.id === t.final!.chosen)?.title} {t.final.is_correct ? "✓ верно" : "✗ неверно"}</strong>
          {t.final.rationale && <span className="small soft">«{t.final.rationale}»</span>}
        </div>
      ) : <span className="small muted">Решение ещё не зафиксировано.</span>}
      <div className="stack sm">
        <span className="eyebrow">Голоса · {t.votes.voters.length} из {live.roster.length}</span>
        <div className="row wrap tight">
          {d.options.map((o) => (
            <span key={o.id} className="chip lg">{o.id}: {t.votes.counts?.[o.id] ?? 0}
              <span className="tile-stack">{Object.entries(t.votes.by ?? {}).filter(([, v]) => v === o.id).map(([pid]) => <PersonTile key={pid} person={people[pid]} size="xs" />)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="stack sm">
        <div className="row between"><span className="eyebrow">Факты · на столе {t.shared.length}{t.key_total ? ` · ключевых в игре ${t.key_total}` : ""}</span>
          <Segmented value={show} onChange={setShow} items={[{ key: "all", title: "Все" }, { key: "shared", title: "Выложенные" }]} /></div>
        {facts.map((f) => (
          <div key={f.fact_id} className={`fact ${f.shared ? "shared" : "secret"}`}>
            <span className="bar-v" style={{ background: f.key ? "var(--accent)" : "var(--ink-3)" }} />
            <div className="stack xs grow">
              <span className="small">{f.text}</span>
              <span className="row wrap tight">
                <span className="chip">{f.role_title ?? f.role}</span>
                {f.key && <span className="chip accent">ключевой</span>}
                {f.shared ? <span className="chip good"><Eye size={11} />на столе</span> : <span className="chip">скрыт</span>}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AirAdmin({ live }: { live: AdminLive }) {
  const people = byId(live.roster);
  const tasks = Object.fromEntries(live.tasks.map((t) => [t.key, t]));
  if (!live.mechanics.chat) return <p className="small muted">Эфир выключен протоколом.</p>;
  if (!live.air.length) return <Empty title="В Эфире тихо" />;
  return (
    <div className="stack xs">
      {live.air.map((m) => {
        const who = people[m.participant_id];
        return (
          <div key={m.message_id} className="msg">
            <PersonTile person={who} size="sm" />
            <div className="stack xs" style={{ minWidth: 0 }}>
              <span className="who" style={{ color: personColor(who?.color_slot) }}>{shortName(who)} <span className="muted" style={{ fontWeight: 500 }}>· {clock(m.sent_at)}{m.during_silence ? " · в тишине" : ""}</span></span>
              <div className={`bubble ${m.during_silence ? "silent" : ""}`}>{m.body === null ? <span className="muted">текст удалён</span> : <Rich text={m.body} people={live.roster} tasks={tasks} />}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ настройки */

export function SettingsPanel({ live, reload }: { live: AdminLive; reload: () => Promise<void> }) {
  const { token } = useFacilitator();
  const { run, busy } = useAction();
  const s = live.session;
  const [work, setWork] = useState(s.work_minutes);
  const [wip, setWip] = useState(s.wip_limit);
  const [sprint, setSprint] = useState(s.sprint_minutes);
  const [notes, setNotes] = useState(live.notes ?? "");
  const [speed, setSpeed] = useState(String(live.team.bot_speed));
  const base = `/api/admin/sessions/${live.team.team_id}/${s.session_id}`;
  const save = (body: Record<string, unknown>, ok = "Сохранено") => run(async () => { await api(base, { method: "PATCH", token, body }); await reload(); }, ok);
  return (
    <div className="stack xl">
      <div className="grid-3">
        <div className="field"><label><Timer size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Длительность работы</label>
          <NumberField label="Длительность работы" value={work} onChange={setWork} min={1} max={240} step={5} suffix="мин" /></div>
        <div className="field"><label>Лимит WIP (Kanban)</label>
          <NumberField label="Лимит WIP" value={wip} onChange={setWip} min={1} max={20} suffix="на этап" /></div>
        <div className="field"><label><Clock size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Длина спринта</label>
          <NumberField label="Длина спринта" value={sprint} onChange={setSprint} min={1} max={120} suffix="мин" /></div>
      </div>
      <div className="row"><button className="btn primary" disabled={busy} onClick={() => save({ work_minutes: work, wip_limit: wip, sprint_minutes: sprint })}>Сохранить параметры</button>
        <span className="tiny muted">Масштаб времени протокола: ×{num(s.time_scale, 2)}.</span></div>
      {live.team.is_demo && (
        <div className="stack sm">
          <span className="label">Скорость ботов</span>
          <Segmented value={speed} onChange={(v) => { setSpeed(v); void save({ bot_speed: Number(v) }, `Боты: ×${v}`); }}
            items={["0.5", "1", "2", "4"].map((v) => ({ key: v, title: `×${v}` }))} />
        </div>
      )}
      <div className="field"><label>Заметки исследователя <span className="muted">(попадают в research.session.notes)</span></label>
        <textarea className="textarea" style={{ minHeight: 140 }} value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)}
          placeholder="Что происходило в комнате: кто спорил, где был перелом, что сказали на разборе…" /></div>
      <div className="row"><button className="btn" disabled={busy} onClick={() => save({ notes })}>Сохранить заметки</button></div>
    </div>
  );
}

