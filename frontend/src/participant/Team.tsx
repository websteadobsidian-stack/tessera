import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, Check, HeartHandshake, MapPin, Star } from "lucide-react";
import { ago } from "../lib/format";
import { personColor, shortName, weatherTitle } from "../lib/people";
import type { HelpRequest } from "../lib/types";
import { SynergyCard } from "../charts/Insights";
import { KudosIcon, PersonTile, WeatherIcon } from "../ui/core";
import { Countdown } from "./Timer";
import { usePlay } from "./context";
import { useWorkUi } from "./workui";

export function TeamPanel() {
  const { state, me } = usePlay();
  const m = state.mechanics;
  const openHelp = state.help.filter((h) => !h.resolved_at);
  return (
    <div className="stack lg">
      {m.synergy && state.synergy && <SynergyCard synergy={state.synergy} compact />}
      {m.help && openHelp.length > 0 && (
        <div className="stack sm">
          <span className="eyebrow">Просят помощи</span>
          <AnimatePresence initial={false}>
            {openHelp.map((h) => <HelpCard key={h.help_id} h={h} mine={h.participant_id === me.participant_id} />)}
          </AnimatePresence>
        </div>
      )}
      <People />
      {m.weather && <Weather />}
      {m.kudos && <KudosFeed />}
      {m.achievements && state.achievements.length > 0 && (
        <div className="stack sm">
          <span className="eyebrow">Достижения команды</span>
          <div className="row wrap tight">
            {state.achievements.map((a) => <span key={a.key} className="chip lg gold" title={a.text}><Star size={13} />{a.title}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function HelpCard({ h, mine }: { h: HelpRequest; mine: boolean }) {
  const { people, me, act, busy } = usePlay();
  const { openTask } = useWorkUi();
  const who = people[h.participant_id];
  const helper = h.helper_id ? people[h.helper_id] : null;
  const iHelp = h.helper_id === me.participant_id;
  return (
    <motion.div className="help-card" layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}>
      <PersonTile person={who} size="lg" />
      <div className="stack xs grow">
        <strong>{mine ? "Вы просите помощи" : `${shortName(who)} просит помощи`}</strong>
        {h.case_key && <button className="task-ref" style={{ alignSelf: "flex-start" }} onClick={() => openTask(h.case_key!)}>#{h.case_key} · {h.case_title}</button>}
        {h.note && <span className="small soft">«{h.note}»</span>}
        <span className="tiny muted">{ago(h.created_at)}{helper && <> · помогает {helper.participant_id === me.participant_id ? "вы" : shortName(helper)}</>}</span>
      </div>
      <div className="stack xs">
        {!mine && !helper && <button className="btn sm good" disabled={busy} onClick={() => act(`/api/p/help/${h.help_id}/answer`, {}, "Спасибо, что откликнулись!")}>Помогу</button>}
        {(mine || iHelp) && <button className="btn sm" disabled={busy} onClick={() => act(`/api/p/help/${h.help_id}/resolve`, {}, "Готово")}><Check size={14} />Готово</button>}
      </div>
    </motion.div>
  );
}

function People() {
  const { state, me } = usePlay();
  const { thank, openTask } = useWorkUi();
  const m = state.mechanics;
  const current = (pid: string) => state.tasks.find((t) => t.assignee === pid && t.started);
  return (
    <div className="stack sm">
      <span className="eyebrow">Команда · {state.roster.filter((p) => p.online).length} на связи</span>
      {state.roster.map((p) => {
        const task = current(p.participant_id);
        const isMe = p.participant_id === me.participant_id;
        return (
          <div key={p.participant_id} className="person-row" style={{ ["--c" as string]: personColor(p.color_slot) }}>
            <PersonTile person={p} size="lg" online={p.online} muted={!!p.away_until} />
            <div className="stack xs grow" style={{ minWidth: 0 }}>
              <span className="row tight" style={{ minWidth: 0 }}>
                <strong className="ellipsis">{shortName(p)}</strong>
                {isMe && <span className="muted small">· вы</span>}
                {m.weather && p.weather && <span title={weatherTitle(p.weather)}><WeatherIcon value={p.weather} size={15} /></span>}
              </span>
              <span className="tiny muted ellipsis">
                {p.orig_role_title ? <><ArrowRightLeft size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> сейчас {p.role_title} (был(а) {p.orig_role_title})</> : p.role_title}
              </span>
              {p.away_until ? (
                <span className="tiny" style={{ color: "var(--warn)" }}><MapPin size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> у клиента · вернётся через <Countdown to={p.away_until} serverNow={state.session.now} /></span>
              ) : task ? (
                <button className="task-ref" style={{ alignSelf: "flex-start" }} onClick={() => openTask(task.key)}>#{task.key} · {task.title}</button>
              ) : <span className="tiny muted">свободен(на)</span>}
            </div>
            {m.kudos && !isMe && (
              <button className="btn ghost icon sm" title={`Сказать спасибо: ${shortName(p)}`} aria-label={`Сказать спасибо: ${shortName(p)}`}
                onClick={() => thank(p.participant_id)}><HeartHandshake size={17} /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Weather() {
  const { state, act, busy } = usePlay();
  const w = state.weather;
  const options = state.scenario.weather;
  return (
    <div className="stack sm">
      <div className="row between">
        <span className="eyebrow">Погода в команде</span>
        {w?.average != null && <span className="row tight small soft"><WeatherIcon value={w.average} size={15} />в среднем «{weatherTitle(w.average)}»</span>}
      </div>
      <div className="weather-row">
        {[...options].sort((a, b) => b.value - a.value).map((o) => (
          <button key={o.id} className="weather-btn" aria-pressed={w?.mine === o.value} disabled={busy}
            onClick={() => act("/api/p/weather", { value: o.value })} title={o.hint}>
            <WeatherIcon value={o.value} size={22} />
            <span>{o.title}</span>
            {w?.counts?.[String(o.value)] ? <span className="tiny muted">{w.counts[String(o.value)]}</span> : <span className="tiny muted">&nbsp;</span>}
          </button>
        ))}
      </div>
      <span className="tiny muted">Меняйте, когда меняется. Команда видит, у кого буря — и может прийти на помощь.</span>
    </div>
  );
}

function KudosFeed() {
  const { state, people, me } = usePlay();
  const { thank } = useWorkUi();
  const kinds = Object.fromEntries(state.scenario.kudos.map((k) => [k.id, k.title]));
  const items = state.kudos.slice(0, 8);
  return (
    <div className="stack sm">
      <div className="row between">
        <span className="eyebrow">Спасибо</span>
        <button className="btn xs" onClick={() => thank()}><HeartHandshake size={13} />Сказать спасибо</button>
      </div>
      {items.length === 0 && <span className="small muted">Пока никто никого не благодарил. Начните первым — это заразно.</span>}
      {items.map((k) => {
        const from = people[k.from_participant], to = people[k.to_participant];
        const toMe = k.to_participant === me.participant_id;
        return (
          <div key={k.kudos_id} className={`kudos-row ${toMe ? "to-me" : ""}`}>
            <span className="kudos-ico" style={{ color: personColor(to?.color_slot) }}><KudosIcon kind={k.kind} size={15} /></span>
            <div className="stack xs grow" style={{ minWidth: 0 }}>
              <span className="small"><strong>{shortName(from)}</strong> → <strong>{toMe ? "вам" : shortName(to)}</strong> <span className="muted">· {kinds[k.kind] ?? k.kind}</span></span>
              {k.note && <span className="tiny soft">«{k.note}»</span>}
            </div>
            <span className="tiny muted nowrap">{ago(k.sent_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

