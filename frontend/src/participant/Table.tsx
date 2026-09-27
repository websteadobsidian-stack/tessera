import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Check, EyeOff, Gavel, Lock, Upload, Users } from "lucide-react";
import { ago, plural } from "../lib/format";
import { personColor, shortName } from "../lib/people";
import type { Option } from "../lib/types";
import { Empty, PersonTile } from "../ui/core";
import { personOptions } from "../ui/options";
import { Select } from "../ui/select";
import { usePlay } from "./context";

/** Общий стол: факты ролей, голосование и итоговое решение (парадигма «скрытого профиля»). */
export function TablePanel() {
  const { state } = usePlay();
  const m = state.mechanics;
  const d = state.scenario.decision;
  const final = state.table?.final;
  return (
    <div className="stack lg">
      <div className="decision-head">
        <span className="eyebrow row tight"><Gavel size={12} />Ключевое решение</span>
        <h3 style={{ fontSize: 18 }}>{d.title}</h3>
        <p className="small soft">{d.question}</p>
      </div>
      {final && <FinalCard />}
      {m.facts && <Facts />}
      {m.vote ? <Voting /> : !final && <KeyDecisionForm />}
    </div>
  );
}

function FinalCard() {
  const { state, people } = usePlay();
  const f = state.table!.final!;
  const opt = state.scenario.decision.options.find((o) => o.id === f.chosen);
  const author = people[f.proposed_by];
  return (
    <motion.div className="final-card" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}>
      <span className="eyebrow">Решение команды</span>
      <div className="row" style={{ gap: 14 }}>
        <span className="option-letter" style={{ background: "var(--accent-strong)", color: "#fff" }}>{f.chosen}</span>
        <div className="stack xs grow">
          <strong style={{ fontSize: 16 }}>{opt?.title}</strong>
          <span className="small muted">{opt?.subtitle}</span>
        </div>
      </div>
      {f.rationale && <p className="small soft">«{f.rationale}»</p>}
      {author && <span className="row tight tiny muted"><PersonTile person={author} size="xs" />предложил(а) {shortName(author)} · {ago(f.decided_at)}</span>}
      <span className="tiny muted">Верно ли — узнаете на разборе.</span>
    </motion.div>
  );
}

function Facts() {
  const { state, people, me, act, busy } = usePlay();
  const t = state.table;
  if (!t) return null;
  const mine = t.my_facts ?? [];
  const unshared = mine.filter((f) => !f.shared);
  const canShare = state.session.phase === "work" || state.session.phase === "briefing";
  return (
    <div className="stack">
      <div className="row between">
        <span className="eyebrow">На столе · {t.shared.length} {plural(t.shared.length, "факт", "факта", "фактов")}</span>
        <div className="tile-stack">
          {[...new Set(t.shared.map((f) => f.owner))].slice(0, 6).map((pid) => <PersonTile key={pid} person={people[pid]} size="xs" />)}
        </div>
      </div>
      {t.shared.length === 0 && (
        <div className="fact" style={{ color: "var(--ink-3)" }}>
          <span className="bar-v" />Пока пусто. У каждой роли есть факты, которых не знают другие. Выложите свои — и попросите коллег.
        </div>
      )}
      <AnimatePresence initial={false}>
        {t.shared.map((f) => {
          const owner = people[f.owner];
          return (
            <motion.div key={f.fact_id} className="fact shared" layout
              initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
              <span className="bar-v" style={{ background: personColor(owner?.color_slot) }} />
              <div className="stack xs grow">
                <span>{f.text}</span>
                <span className="row tight tiny muted"><PersonTile person={owner} size="xs" />{shortName(owner)} · {f.role_title ?? f.role} · {ago(f.shared_at)}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {mine.length > 0 && (
        <div className="stack sm" style={{ marginTop: 6 }}>
          <span className="eyebrow row tight"><Lock size={12} />Ваши факты · знаете только вы</span>
          {mine.map((f) => (
            <div key={f.fact_id} className={`fact ${f.shared ? "" : "secret"}`}>
              <span className="bar-v" style={{ background: personColor(me.color_slot), opacity: f.shared ? 0.4 : 1 }} />
              <span className="grow" style={{ color: f.shared ? "var(--ink-3)" : undefined }}>{f.text}</span>
              {f.shared ? <span className="chip good" style={{ alignSelf: "flex-start" }}><Check size={12} />на столе</span> : (
                <button className="btn xs" style={{ alignSelf: "flex-start" }} disabled={busy || !canShare}
                  onClick={() => act("/api/p/table/facts", { fact_id: f.fact_id }, "Факт на столе")}>
                  <Upload size={13} />Выложить
                </button>
              )}
            </div>
          ))}
          {unshared.length > 0 && <span className="tiny muted">Лучший вариант виден, только если сложить факты всех ролей.</span>}
        </div>
      )}
    </div>
  );
}

function Voting() {
  const { state, me, people, act, busy } = usePlay();
  const t = state.table;
  const [rationale, setRationale] = useState("");
  if (!t) return null;
  const v = t.votes;
  const opts = state.scenario.decision.options;
  const final = t.final;
  const team = state.roster.length;
  const hier = state.team.condition === "hierarchy";
  const enough = v.voters.length * 2 >= team;
  const counts = v.counts;
  const top = counts ? Math.max(0, ...Object.values(counts)) : 0;
  const tie = counts ? Object.values(counts).filter((n) => n === top).length > 1 : false;
  const working = state.session.phase === "work";
  const voterOf = (o: Option) => (v.by ? Object.entries(v.by).filter(([, x]) => x === o.id).map(([pid]) => people[pid]) : []);

  return (
    <div className="stack">
      <div className="row between">
        <span className="eyebrow">Голосование</span>
        <span className="row tight tiny muted"><Users size={13} />{v.voters.length} из {team}</span>
      </div>
      {opts.map((o) => {
        const chosen = v.mine === o.id;
        const n = counts?.[o.id] ?? 0;
        return (
          <button key={o.id} className="vote-option" aria-pressed={chosen} disabled={busy || !!final || !working}
            onClick={() => act("/api/p/table/vote", { option: o.id })}>
            <span className="option-letter">{o.id}</span>
            <span className="stack xs grow" style={{ minWidth: 0 }}>
              <strong>{o.title}</strong>
              {o.subtitle && <span className="tiny muted">{o.subtitle}</span>}
              {counts && (
                <span className="vote-bar"><span style={{ width: `${team ? (n / team) * 100 : 0}%` }} /></span>
              )}
            </span>
            <span className="stack xs" style={{ alignItems: "flex-end" }}>
              {counts && <span className="display" style={{ fontSize: 18, fontWeight: 600 }}>{n}</span>}
              {v.by && <span className="tile-stack">{voterOf(o).slice(0, 5).map((p) => p && <PersonTile key={p.participant_id} person={p} size="xs" />)}</span>}
              {chosen && <span className="chip accent"><Check size={12} />ваш</span>}
            </span>
          </button>
        );
      })}
      {!counts && !final && (
        <span className="row tight tiny muted"><EyeOff size={13} />Голоса скрыты до решения: видно только, кто уже проголосовал.</span>
      )}
      {v.voters.length > 0 && (
        <div className="row tight wrap">
          {v.voters.map((pid) => <PersonTile key={pid} person={people[pid]} size="xs" title={shortName(people[pid])} />)}
          <span className="tiny muted">уже проголосовали</span>
        </div>
      )}
      {!final && working && (
        <div className="stack sm" style={{ marginTop: 4 }}>
          <textarea className="textarea" style={{ minHeight: 64 }} maxLength={1000} value={rationale} onChange={(e) => setRationale(e.target.value)}
            placeholder="Почему этот вариант? (по желанию — попадёт в журнал решений)" />
          <button className="btn accent block" disabled={busy || (hier ? !me.is_pm || !v.mine : !enough || (!!counts && tie))}
            onClick={() => act("/api/p/table/finalize", { rationale: rationale.trim() || null }, "Решение зафиксировано")}>
            <Gavel size={16} />Зафиксировать решение
          </button>
          <span className="tiny muted">
            {hier ? (me.is_pm ? "В иерархии решение фиксирует руководитель — ваш голос станет решением." : "В иерархии решение фиксирует руководитель.")
              : !enough ? `Нужно, чтобы проголосовала хотя бы половина команды (${Math.ceil(team / 2)}).`
                : counts && tie ? "Голоса разделились поровну — договоритесь." : "Решение — вариант большинства. Зафиксировать может любой."}
          </span>
        </div>
      )}
    </div>
  );
}

/** Когда голосование выключено протоколом: решение записывается одним действием. */
function KeyDecisionForm() {
  const { state, me, act, busy } = usePlay();
  const [chosen, setChosen] = useState<string | null>(null);
  const [by, setBy] = useState<string>(me.participant_id);
  const [rationale, setRationale] = useState("");
  const hier = state.team.condition === "hierarchy";
  const allowed = state.session.phase === "work" && (!hier || me.is_pm);
  const done = state.decisions.find((d) => d.key_decision);
  if (done) return null;
  if (!allowed) {
    return <Empty title="Решение ещё не принято">{hier ? "В иерархии ключевое решение записывает руководитель." : "Записать решение можно во время работы."}</Empty>;
  }
  return (
    <div className="stack">
      <span className="eyebrow">Записать решение команды</span>
      {state.scenario.decision.options.map((o) => (
        <button key={o.id} className="vote-option" aria-pressed={chosen === o.id} onClick={() => setChosen(o.id)}>
          <span className="option-letter">{o.id}</span>
          <span className="stack xs grow"><strong>{o.title}</strong>{o.subtitle && <span className="tiny muted">{o.subtitle}</span>}</span>
        </button>
      ))}
      <div className="field">
        <label>Кто предложил</label>
        <Select label="Кто предложил" value={by} options={personOptions(state.roster, me.participant_id)} onChange={setBy} showHint />
      </div>
      <textarea className="textarea" style={{ minHeight: 64 }} value={rationale} maxLength={2000} onChange={(e) => setRationale(e.target.value)}
        placeholder="Почему этот вариант?" />
      <button className="btn accent" disabled={busy || !chosen}
        onClick={() => act("/api/p/decisions", { key_decision: true, chosen, proposed_by: by, rationale: rationale.trim() || null }, "Решение записано")}>
        <Gavel size={16} />Записать решение
      </button>
    </div>
  );
}
