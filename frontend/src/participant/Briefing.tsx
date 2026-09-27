import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Check, CircleCheck, CircleX, Eye, EyeOff, Handshake, Lock, Scale, Target, Telescope } from "lucide-react";
import { capitalize, personColor, shortName } from "../lib/people";
import { PersonTile } from "../ui/core";
import { Reveal } from "../ui/effects";
import { usePlay } from "./context";

export function Briefing() {
  const { state } = usePlay();
  const sc = state.scenario;
  const m = state.mechanics;
  const b = state.briefing;
  const checks = [
    m.preference && { key: "pre", title: "Личный выбор", done: !!state.table?.my_pre },
    m.check && { key: "check", title: "Проверка правил", done: !!b?.check_results },
    m.forecast && { key: "forecast", title: "Прогноз", done: !!b?.forecast },
    m.charter && { key: "charter", title: "Договор команды", done: Object.keys(state.charter).length >= 3 },
  ].filter(Boolean) as { key: string; title: string; done: boolean }[];

  return (
    <main className="page stack xl">
      <div className="row between wrap top" style={{ gap: 20 }}>
        <div className="stack">
          <span className="eyebrow">Брифинг</span>
          <h1>Компания «{sc.title}»</h1>
        </div>
        {checks.length > 0 && (
          <div className="stack sm" style={{ alignItems: "flex-end" }}>
            <span className="tiny muted">Готовность · {checks.filter((c) => c.done).length} из {checks.length}</span>
            <div className="checklist">
              {checks.map((c) => (
                <a key={c.key} href={`#${c.key}`} className={`item ${c.done ? "done" : ""}`} style={{ textDecoration: "none" }}>
                  {c.done ? <Check size={14} /> : <span style={{ width: 14 }} />}{c.title}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="chapters">
        {sc.legend.map((ch, i) => (
          <Reveal key={i} delay={i * 0.07}>
            <div className="panel chapter stack" style={{ height: "100%" }}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{ch.title}</h3>
              <p className="soft small">{ch.text}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <RoleSection />
        <div className="stack lg">
          <div className="panel stack">
            <div className="row between"><div className="panel-title"><Scale size={18} /><h3>Как вы работаете: {sc.condition.title}</h3></div>
              <span className="chip" style={{ color: `var(--cond-${sc.condition.key})` }}><span className="dot" />{sc.condition.tagline}</span></div>
            <ol className="stack sm" style={{ margin: 0, paddingLeft: 20 }}>
              {sc.condition.rules.map((r, i) => <li key={i} className="soft">{r}</li>)}
            </ol>
          </div>
          <div className="panel stack sm">
            <h3>Путь задачи</h3>
            <p className="soft small">Анализ → Проектирование → Исполнение → Контроль → Сдача. Возьмите задачу в работу, закончите — передайте дальше. Не прошла контроль — вернётся на доработку, это нормально.</p>
            <p className="soft small">Говорите вслух. Система фиксирует только результат: кто, что и когда сделал.</p>
          </div>
          {b?.agreements_prev && b.agreements_prev.length > 0 && (
            <div className="panel glow stack sm">
              <div className="panel-title"><Handshake size={18} /><h3>Вы договорились в прошлый раз</h3></div>
              {b.agreements_prev.map((a) => <div key={a.agreement_id} className="fact"><span className="bar-v" style={{ background: "var(--accent)" }} />{a.body}</div>)}
              <span className="tiny muted">В конце сессии спросим, получилось ли.</span>
            </div>
          )}
        </div>
      </div>

      {m.preference && <Preference />}
      {(m.check || m.forecast) && (
        <div className="grid-2" style={{ alignItems: "start" }}>
          {m.check && <CheckQuiz />}
          {m.forecast && <Forecast />}
        </div>
      )}
      {m.charter && <Charter />}
    </main>
  );
}

function RoleSection() {
  const { state, me } = usePlay();
  const role = state.scenario.my_role;
  const facts = state.table?.my_facts ?? [];
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  return (
    <div className="panel stack lg" style={{ background: `radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, ${personColor(me.color_slot)} 18%, transparent), transparent 60%), var(--glass)` }}>
      <div className="row" style={{ gap: 14 }}>
        <PersonTile person={me} size="xl" />
        <div className="stack xs">
          <span className="eyebrow">Ваша роль</span>
          <h2 style={{ fontSize: 24 }}>{capitalize(role?.title ?? me.role_title)}</h2>
          <span className="small muted">{role?.department}{role?.home_stages?.length ? ` · ваш этап — «${role.home_stages.join("», «")}»` : ""}</span>
        </div>
      </div>
      <p className="soft">{role?.summary}</p>
      {facts.length > 0 && (
        <div className="stack sm">
          <div className="row between"><span className="eyebrow row tight"><Lock size={12} /> Знаете только вы</span>
            <span className="tiny muted">нажмите, чтобы открыть</span></div>
          {facts.map((f, i) => (
            <motion.button key={f.fact_id} className="fact secret" style={{ cursor: "pointer", textAlign: "left", color: "var(--ink)" }}
              initial={{ rotateX: -80, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.12, type: "spring", stiffness: 180, damping: 18 }}
              onClick={() => setFlipped((x) => ({ ...x, [f.fact_id]: !x[f.fact_id] }))}>
              <span className="bar-v" style={{ background: personColor(me.color_slot) }} />
              <span className="grow" style={{ filter: flipped[f.fact_id] || f.shared ? "none" : "blur(5px)", transition: "filter .3s" }}>{f.text}</span>
              {flipped[f.fact_id] || f.shared ? <Eye size={16} color="var(--ink-3)" /> : <EyeOff size={16} color="var(--ink-3)" />}
            </motion.button>
          ))}
          <p className="tiny muted">На работе вы сможете выложить факты на общий стол. Лучшее решение видно, только если сложить факты всех ролей.</p>
        </div>
      )}
      <div className="stack sm">
        <span className="eyebrow">Знают все</span>
        {state.scenario.shared_facts.map((f, i) => <div key={i} className="fact"><span className="bar-v" />{f}</div>)}
      </div>
    </div>
  );
}

function Preference() {
  const { state, act, busy } = usePlay();
  const d = state.scenario.decision;
  const mine = state.table?.my_pre;
  const [option, setOption] = useState<string | null>(mine?.option ?? null);
  const [conf, setConf] = useState<number>(mine?.confidence ?? 3);
  return (
    <div className="panel stack lg" id="pre">
      <div className="row between wrap">
        <div className="panel-title"><Target size={18} /><h3>Ваш личный выбор — до обсуждения</h3></div>
        {mine && <span className="chip good"><Check size={13} />сохранён</span>}
      </div>
      <p className="soft">{d.question} Решите сами, по тому, что знаете прямо сейчас. Ваш выбор не увидит команда — только исследование.</p>
      <div className="grid-3">
        {d.options.map((o) => (
          <button key={o.id} className="option-card" aria-pressed={option === o.id} onClick={() => setOption(o.id)}>
            <span className="option-letter">{o.id}</span>
            <span className="stack xs"><strong>{o.title}</strong><span className="small muted">{o.subtitle}</span></span>
          </button>
        ))}
      </div>
      <div className="row wrap between">
        <div className="row wrap">
          <span className="small soft">Уверенность</span>
          <div className="segmented">
            {[1, 2, 3, 4, 5].map((v) => <button key={v} aria-pressed={conf === v} onClick={() => setConf(v)}>{v}</button>)}
          </div>
        </div>
        <button className="btn primary" disabled={!option || busy}
          onClick={() => act("/api/p/briefing/preference", { option, confidence: conf }, "Выбор сохранён")}>
          {mine ? "Обновить выбор" : "Сохранить выбор"}
        </button>
      </div>
    </div>
  );
}

function CheckQuiz() {
  const { state, act, busy } = usePlay();
  const b = state.briefing!;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const results = b.check_results;
  return (
    <div className="panel stack lg" id="check">
      <div className="row between"><div className="panel-title"><CircleCheck size={18} /><h3>Проверьте себя</h3></div>
        {results && <span className="chip good"><Check size={13} />готово</span>}</div>
      {b.check.map((q) => {
        const res = results?.[q.id];
        return (
          <div key={q.id} className="stack sm">
            <strong>{q.question}</strong>
            <div className="stack xs">
              {q.options.map((o) => {
                const chosen = (res?.answer ?? answers[q.id]) === o.id;
                const tone = res && chosen ? (res.correct ? "var(--good)" : "var(--bad)") : undefined;
                return (
                  <button key={o.id} className="pick" aria-pressed={!res && chosen} disabled={!!res}
                    style={tone ? { borderColor: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` } : undefined}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}>
                    {res && chosen && (res.correct ? <CircleCheck size={16} color="var(--good)" /> : <CircleX size={16} color="var(--bad)" />)}
                    <span style={{ fontWeight: 550 }}>{o.title}</span>
                  </button>
                );
              })}
            </div>
            {res && !res.correct && <span className="tiny" style={{ color: "var(--bad)" }}>Не совсем. Перечитайте правила методики выше.</span>}
          </div>
        );
      })}
      {!results && (
        <button className="btn primary" disabled={busy || b.check.some((q) => !answers[q.id])}
          onClick={() => act("/api/p/briefing/check", { answers })}>Проверить</button>
      )}
    </div>
  );
}

function Forecast() {
  const { state, act, busy } = usePlay();
  const b = state.briefing!;
  const [tasks, setTasks] = useState<number>(b.forecast?.tasks_done ?? Math.round(b.tasks_total * 0.6));
  const [onTime, setOnTime] = useState<boolean | null>(b.forecast ? !!b.forecast.m1_on_time : null);
  const [conf, setConf] = useState<number>(b.forecast?.confidence ?? 3);
  return (
    <div className="panel stack lg" id="forecast">
      <div className="row between"><div className="panel-title"><Telescope size={18} /><h3>Ваш прогноз</h3></div>
        {b.forecast && <span className="chip good"><Check size={13} />сохранён</span>}</div>
      <div className="stack sm">
        <div className="row between"><span className="soft">Сколько задач команда сдаст до конца?</span>
          <span className="display" style={{ fontSize: 30, fontWeight: 600 }}>{tasks}</span></div>
        <input type="range" className="range" min={0} max={b.tasks_total + 1} value={tasks}
          style={{ ["--fill" as string]: `${(tasks / (b.tasks_total + 1)) * 100}%` }} onChange={(e) => setTasks(Number(e.target.value))} />
      </div>
      <div className="row between wrap">
        <span className="soft">Закроем веху M-1 в срок?</span>
        <div className="segmented">
          <button aria-pressed={onTime === true} onClick={() => setOnTime(true)}>Да</button>
          <button aria-pressed={onTime === false} onClick={() => setOnTime(false)}>Нет</button>
        </div>
      </div>
      <div className="row between wrap">
        <span className="soft">Уверенность</span>
        <div className="segmented">{[1, 2, 3, 4, 5].map((v) => <button key={v} aria-pressed={conf === v} onClick={() => setConf(v)}>{v}</button>)}</div>
      </div>
      <button className="btn primary" disabled={busy || onTime === null}
        onClick={() => act("/api/p/briefing/forecast", { tasks_done: tasks, m1_on_time: onTime, confidence: conf }, "Прогноз сохранён")}>
        {b.forecast ? "Обновить прогноз" : "Сохранить прогноз"}
      </button>
      <span className="tiny muted">На разборе сравним прогнозы команды с реальностью.</span>
    </div>
  );
}

export function Charter({ compact }: { compact?: boolean }) {
  const { state, people } = usePlay();
  return (
    <div className={compact ? "stack" : "panel stack lg"} id="charter">
      {!compact && (
        <div className="stack xs">
          <div className="panel-title"><Handshake size={18} /><h3>Договор команды</h3></div>
          <span className="small muted">Общий для всех: любой может дописать или поправить. Видно, кто правил последним.</span>
        </div>
      )}
      <div className={compact ? "stack" : "grid-2"}>
        {state.scenario.charter.map((f) => <CharterField key={f.id} field={f} entry={state.charter[f.id]} author={people[state.charter[f.id]?.participant_id]} />)}
      </div>
    </div>
  );
}

function CharterField({ field, entry, author }: {
  field: { id: string; title: string; placeholder: string; optional?: boolean };
  entry?: { body: string; participant_id: string; updated_at: string };
  author?: { display_name: string | null; role_title: string; color_slot: number };
}) {
  const { act, state } = usePlay();
  const [value, setValue] = useState(entry?.body ?? "");
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setValue(entry?.body ?? ""); }, [entry?.body, focus]);
  const editable = ["briefing", "work"].includes(state.session.phase);
  return (
    <div className="field">
      <label className="row between"><span>{field.title}{field.optional && <span className="muted"> · по желанию</span>}</span>
        {author && <span className="row tight tiny muted"><PersonTile person={author} size="xs" />{shortName(author)}</span>}</label>
      <textarea className="textarea" style={{ minHeight: 70 }} value={value} placeholder={field.placeholder} disabled={!editable}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); if (value.trim() !== (entry?.body ?? "")) act("/api/p/charter", { field: field.id, body: value }); }}
        onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}
