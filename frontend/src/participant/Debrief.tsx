import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { FlowChart } from "../charts/FlowChart";
import {
  Contribution, ForecastChart, HBars, HiddenProfile, ProbeResults, SynergyCard, TimelineList, WeatherTimeline, waitingRows,
} from "../charts/Insights";
import { Network } from "../charts/Network";
import { ProcessMap } from "../charts/ProcessMap";
import { api } from "../lib/api";
import { minutes, num, pct, plural } from "../lib/format";
import { capitalize, personColor, shortName } from "../lib/people";
import type { Debrief, Tile } from "../lib/types";
import { Mosaic } from "../mosaic/Mosaic";
import { KudosIcon, Loader, PersonTile, Stat } from "../ui/core";
import { Reveal, TileBurst } from "../ui/effects";
import { usePlay } from "./context";

type PersonLike = { participant_id: string; display_name: string | null; role?: string; role_title?: string; color_slot: number };

export const debriefPeople = (d: Debrief) => d.people.map((p) => ({ ...p, role_title: p.role }));

/** Разбор для участника: портрет, личный фрагмент и история команды. */
export function ParticipantDebrief() {
  const { state, token, me } = usePlay();
  const [data, setData] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const phase = state.session.phase;
  useEffect(() => {
    api<Debrief>("/api/p/debrief", { token })
      .then((d) => { setData(d); setBurst(Date.now()); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token, phase]);
  if (!data) return <main className="page narrow"><Loader label={error ?? "Собираем портрет команды…"} /></main>;
  const people = debriefPeople(data);
  return (
    <main className="page stack xl">
      <TileBurst trigger={burst} count={48} />
      <DebriefHero data={data} company={state.company.title} exportName={`tessera-${data.team_id}-${data.session_id}.png`} />
      {data.personal && <FragmentCard personal={data.personal} people={people} meSlot={me.color_slot} tiles={data.tiles} actual={data.forecast.actual_tasks} />}
      <TeamDebrief data={data} audience="team" />
      <p className="center small muted">Ведущий проведёт разбор вслух. Дальше — {state.mechanics.retro ? "ретро и договорённости" : "короткий выходной опрос"}.</p>
    </main>
  );
}

export function DebriefHero({ data, company, exportName, aside }: { data: Debrief; company?: string; exportName?: string; aside?: ReactNode }) {
  const people = debriefPeople(data);
  const done = data.tasks.filter((t) => t.stage === "Сдача").length;
  return (
    <section className="debrief-hero">
      <div className="stack dh-head">
        <span className="eyebrow">Разбор{company ? ` · «${company}»` : ""}</span>
        <h1 className="gradient-text">Портрет вашей команды</h1>
        <p className="soft" style={{ fontSize: 17, maxWidth: 560 }}>
          Каждая плитка — действие одного из вас. Двухцветные — моменты, когда вы работали вместе: передали задачу, помогли, поблагодарили.
          Нажмите «▶», чтобы увидеть, как складывалась картина.
        </p>
      </div>
      <div className="stack lg dh-body">
        <div className="stats">
          <Stat k="Плиток в портрете" v={data.tiles.length} />
          <Stat k="Сдано задач" v={done} d={`из ${data.tasks.length}`} />
          <Stat k="Спасибо" v={data.kudos.total} />
        </div>
        {data.synergy && data.mechanics.synergy && <div className="panel"><SynergyCard synergy={data.synergy} /></div>}
        {data.achievements.length > 0 && (
          <div className="row wrap tight">
            {data.achievements.map((a) => <span key={a.key} className="chip lg gold" title={a.text}><Star size={13} />{a.title}</span>)}
          </div>
        )}
        {aside}
      </div>
      <div className="panel dh-art" style={{ padding: 24 }}>
        <Mosaic tiles={data.tiles} people={people} size={460} exportName={exportName} highlight={null} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ личная карточка */

const ARCHETYPE_TITLES: Record<string, string> = { "узел": "Узел", "опора": "Опора", "связной": "Связной", "мастер": "Мастер" };

export function FragmentCard({ personal, people, meSlot, tiles, actual }: {
  personal: NonNullable<Debrief["personal"]>; people: PersonLike[]; meSlot: number; tiles?: Tile[]; actual?: number;
}) {
  const withMost = personal.with_most ? people.find((p) => p.participant_id === personal.with_most) : null;
  const me = people.find((p) => p.participant_id === personal.participant_id);
  const myTiles = tiles?.filter((t) => t.a === personal.participant_id || t.b === personal.participant_id) ?? [];
  const s = personal.stats;
  const strengths = Object.entries(personal.strengths).sort((a, b) => b[1] - a[1]);
  return (
    <Reveal>
      <section className="fragment-card" style={{ ["--me" as string]: personColor(meSlot) }}>
        <div className="fragment-grid">
          <div className="stack lg">
            <div className="stack sm">
              <span className="eyebrow">Ваш фрагмент{me ? ` · ${capitalize(me.role_title ?? me.role ?? "")}` : ""}</span>
              <span className="big">{ARCHETYPE_TITLES[personal.archetype] ?? capitalize(personal.archetype)}</span>
              <p className="soft" style={{ maxWidth: 460 }}>{personal.archetype_text}</p>
            </div>
            <div className="grid-4">
              <Stat k="Ваших плиток" v={personal.tiles} d={`${pct(personal.tiles_share)} портрета`} />
              <Stat k="Сдали дальше" v={s.completed ?? 0} d={`взяли ${s.started ?? 0}`} />
              <Stat k="Помогли" v={s.helps_given ?? 0} d={`просили ${s.helps_asked ?? 0}`} />
              <Stat k="Спасибо" v={s.kudos_received ?? 0} d={`сказали ${s.kudos_sent ?? 0}`} />
            </div>
            <div className="stack sm">
              {withMost && (
                <span className="row tight"><PersonTile person={withMost} size="sm" />
                  <span className="soft">Больше всего совместных плиток — с <strong style={{ color: "var(--ink)" }}>{shortName(withMost)}</strong></span></span>
              )}
              {personal.forecast && (
                <span className="soft small">
                  Ваш прогноз: {personal.forecast.tasks_done} {plural(personal.forecast.tasks_done, "задача", "задачи", "задач")}
                  {actual !== undefined && <> · на деле {actual}{Math.abs(actual - personal.forecast.tasks_done) <= 1 ? " — точное попадание!" : ""}</>}
                </span>
              )}
              {Object.keys(personal.kudos_by_kind).length > 0 && (
                <div className="row wrap tight">
                  {Object.entries(personal.kudos_by_kind).map(([k, n]) => <span key={k} className="chip lg"><KudosIcon kind={k} size={14} />× {n}</span>)}
                </div>
              )}
              {personal.kudos_notes.slice(-2).map((n, i) => <p key={i} className="small soft">«{n}»</p>)}
              {strengths.length > 0 && (
                <div className="stack xs">
                  <span className="eyebrow">Коллеги отметили в вас</span>
                  <div className="row wrap tight">{strengths.map(([k, n]) => <span key={k} className="chip lg accent">{k} · {n}</span>)}</div>
                </div>
              )}
            </div>
          </div>
          {myTiles.length > 0 && (
            <div className="fragment-mosaic">
              <Mosaic tiles={myTiles} people={people.map((p) => ({ ...p, role_title: p.role_title ?? p.role }))} size={240} showLegend={false} replayable={false} minCols={6} highlight={null} />
            </div>
          )}
        </div>
      </section>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ история команды */

function Chapter({ n, title, lead, children, id }: { n: number; title: string; lead?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Reveal>
      <section className="chapter-block" id={id}>
        <div className="chapter-side">
          <span className="chapter-n">{String(n).padStart(2, "0")}</span>
          <h2>{title}</h2>
          {lead && <p className="soft small">{lead}</p>}
        </div>
        <div className="chapter-body">{children}</div>
      </section>
    </Reveal>
  );
}

export function TeamDebrief({ data, audience }: { data: Debrief; audience: "team" | "facilitator" }) {
  const m = data.mechanics;
  const s = data.summary;
  const chapters: { key: string; title: string; lead?: ReactNode; body: ReactNode }[] = [];

  if (m.facts || m.vote || m.preference) {
    const p = data.pooling;
    chapters.push({
      key: "pooling", title: "Картина решения",
      lead: <>У каждой роли были факты, которых не знали другие. Лучший вариант — <strong style={{ color: "var(--ink)" }}>{p.decision.correct}</strong> — виден, только если сложить их вместе.{" "}
        {p.decision.is_correct === true ? "Вы его нашли." : p.decision.is_correct === false ? "В этот раз картина не сложилась." : "Решение не зафиксировано."}</>,
      body: <HiddenProfile data={data} />,
    });
  }
  chapters.push({
    key: "process", title: "Как шла работа",
    lead: "Карта процесса по вашим действиям: какие переходы были, где задачи ждали и где возвращались на доработку.",
    body: (
      <div className="stack lg">
        {s && (
          <div className="stats four">
            <Stat k="Цикл задачи" v={minutes(s.cycle_hours_mean)} unit="мин" digits={1} />
            <Stat k="Ожидание" v={minutes(s.waiting_hours_mean)} unit="мин" digits={1} />
            <Stat k="Доработки" v={s.rework_case_share === null ? null : s.rework_case_share * 100} unit="%" d="задач возвращались" />
            <Stat k="Узкое место" v={null} raw={<span style={{ fontSize: 20 }}>{s.bottleneck_stage ?? "—"}</span>} />
          </div>
        )}
        <div className="panel pad-sm"><ProcessMap dfg={data.dfg} waiting={data.waiting_by_stage} /></div>
        <div className="panel stack"><h3>Накопленный поток</h3><FlowChart flow={data.flow} timeline={data.timeline} /></div>
        <div className="panel stack"><h3>Где ждали</h3><HBars rows={waitingRows(data)} unit="мин" /></div>
      </div>
    ),
  });
  chapters.push({
    key: "network", title: "Кто с кем",
    lead: "Сеть команды: передачи работы, упоминания в Эфире, помощь и благодарности. Толще линия — больше связей.",
    body: <div className="panel pad-sm"><Network data={data} /></div>,
  });
  if (m.probes || m.forecast) {
    chapters.push({
      key: "sync", title: "Видите ли вы одно и то же",
      lead: "Синхрон спрашивал всех одновременно. Прогноз вы дали до начала — теперь его можно сравнить с реальностью.",
      body: (
        <div className="grid-2">
          {m.probes && <div className="panel stack"><h3>Синхрон</h3><ProbeResults data={data} /></div>}
          {m.forecast && <div className="panel stack"><h3>Прогноз и реальность</h3><ForecastChart data={data} /></div>}
        </div>
      ),
    });
  }
  const mood = m.weather || m.help || m.kudos || m.chat;
  if (mood) {
    chapters.push({
      key: "people", title: "Как вам было вместе",
      lead: "Погода, просьбы о помощи, благодарности и разговоры — то, из чего складывается психологическая безопасность.",
      body: (
        <div className="stack lg">
          <div className="stats four">
            {m.help && <Stat k="Просьб о помощи" v={data.help.total} d={data.help.total ? `откликнулись на ${data.help.answered}` : "никто не просил"} />}
            {m.help && <Stat k="Отклик на помощь" v={data.help.median_latency} unit="мин" digits={1} d="медиана" />}
            {m.kudos && <Stat k="Спасибо" v={data.kudos.total} d={data.kudos.reciprocity === null ? undefined : `взаимность ${pct(data.kudos.reciprocity)}`} />}
            {m.chat && <Stat k="Сообщений в Эфире" v={data.chat.total} d={data.chat.during_silence ? `${data.chat.during_silence} в тишине` : undefined} />}
          </div>
          {m.weather && <div className="panel stack"><h3>Погода в команде</h3><WeatherTimeline data={data} /></div>}
          {m.kudos && data.kudos.items.length > 0 && <KudosWall data={data} />}
        </div>
      ),
    });
  }
  if (m.mirror && data.mirror.stress_actual !== null) {
    chapters.push({ key: "mirror", title: "Зеркало", lead: "Насколько точно вы чувствуете друг друга: догадки против того, что команда ответила на самом деле.", body: <Mirror data={data} /> });
  }
  chapters.push({
    key: "balance", title: "Вклад каждого",
    lead: "Не рейтинг, а форма участия. Ровное распределение обычно значит, что команда не держится на одном человеке.",
    body: <div className="panel"><Contribution people={data.people} gini={data.balance.gini} /></div>,
  });
  if (data.agreements.items.length > 0) {
    chapters.push({
      key: "agreements", title: "Договорённости", lead: "Что команда решила в прошлый раз — и как оценила выполнение.",
      body: (
        <div className="stack sm">
          {data.agreements.items.map((a) => (
            <div key={a.agreement_id} className="fact shared">
              <span className="bar-v" style={{ background: "var(--accent)" }} />
              <span className="grow">{a.body}</span>
              <span className="chip">{a.mean === null ? "нет оценок" : `${num(a.mean)} из 5`}</span>
            </div>
          ))}
        </div>
      ),
    });
  }
  if (audience === "facilitator" || data.timeline.length > 0) {
    chapters.push({
      key: "timeline", title: "Что с вами происходило", lead: "Вбросы, эксперименты и подсказки — по минутам рабочей сессии.",
      body: <div className="panel"><TimelineList items={data.timeline} /></div>,
    });
  }

  return (
    <div className="stack xl">
      <nav className="chapter-nav" aria-label="Разделы разбора">
        {chapters.map((c, i) => <a key={c.key} href={`#ch-${c.key}`} className="chip lg outline">{String(i + 1).padStart(2, "0")} · {c.title}</a>)}
      </nav>
      {chapters.map((c, i) => <Chapter key={c.key} id={`ch-${c.key}`} n={i + 1} title={c.title} lead={c.lead}>{c.body}</Chapter>)}
    </div>
  );
}

function KudosWall({ data }: { data: Debrief }) {
  const people = Object.fromEntries(debriefPeople(data).map((p) => [p.participant_id, p]));
  return (
    <div className="kudos-wall">
      {data.kudos.items.slice(0, 18).map((k, i) => {
        const from = people[k.from_participant], to = people[k.to_participant];
        return (
          <motion.div key={k.kudos_id} className="kudos-note" style={{ ["--c" as string]: personColor(to?.color_slot) }}
            initial={{ opacity: 0, y: 10, rotate: 0 }} whileInView={{ opacity: 1, y: 0, rotate: ((i * 37) % 7) - 3 }} viewport={{ once: true }}
            transition={{ delay: (i % 6) * 0.05 }}>
            <span className="row tight"><KudosIcon kind={k.kind} size={14} /><strong className="small">{shortName(to)}</strong></span>
            {k.note ? <span className="small">«{k.note}»</span> : <span className="small muted">без слов, но от души</span>}
            <span className="tiny muted">от {shortName(from)}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function Mirror({ data }: { data: Debrief }) {
  const mr = data.mirror;
  const people = Object.fromEntries(debriefPeople(data).map((p) => [p.participant_id, p]));
  const guesses = Object.values(mr.stress_guesses);
  const loaded = mr.loaded_actual ? people[mr.loaded_actual] : null;
  const picks = Object.values(mr.loaded_picks);
  return (
    <div className="grid-2">
      <div className="panel stack">
        <h3>Стресс команды</h3>
        <p className="small soft">Вы угадывали средний уровень стресса команды (шкала «раздражение и стресс» NASA-TLX). Точки — ваши догадки, линия — как было на самом деле.</p>
        <div className="mirror-scale">
          <div className="track" />
          {guesses.map((g, i) => <span key={i} className="guess" style={{ left: `${Math.min(100, Math.max(0, g))}%` }} />)}
          {mr.stress_actual !== null && <span className="actual" style={{ left: `${Math.min(100, Math.max(0, mr.stress_actual))}%` }}><b>{num(mr.stress_actual, 0)}</b></span>}
        </div>
        <div className="row between tiny muted"><span>0 — спокойно</span><span>100 — на пределе</span></div>
        {mr.stress_error !== null && <span className="small">Средняя ошибка догадки — <strong>{num(mr.stress_error, 0)}</strong> пунктов.</span>}
      </div>
      <div className="panel stack">
        <h3>Кто был загружен больше всех</h3>
        {loaded ? (
          <>
            <div className="row"><PersonTile person={loaded} size="lg" /><div className="stack xs"><strong>{shortName(loaded)}</strong><span className="small muted">по реальной доле передач работы</span></div></div>
            <span className="small soft">Угадали {picks.filter((p) => p === mr.loaded_actual).length} из {picks.length} {mr.loaded_accuracy !== null && `(${pct(mr.loaded_accuracy)})`}.</span>
          </>
        ) : <span className="small muted">Недостаточно данных.</span>}
      </div>
    </div>
  );
}

