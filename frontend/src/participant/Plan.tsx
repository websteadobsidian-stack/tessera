import { useState } from "react";
import { Bell, CalendarClock, Flag, NotebookPen, Plus } from "lucide-react";
import { clock } from "../lib/format";
import { shortName } from "../lib/people";
import type { Milestone } from "../lib/types";
import { PersonTile } from "../ui/core";
import { Modal } from "../ui/overlays";
import { NOBODY, nobodyOption, personOptions, taskOptions } from "../ui/options";
import { Select } from "../ui/select";
import { Charter } from "./Briefing";
import { Countdown } from "./Timer";
import { usePlay } from "./context";
import { NOTICE_ICONS } from "./Overlays";

export function PlanPanel() {
  const { state } = usePlay();
  return (
    <div className="stack lg">
      <div className="stack sm">
        <span className="eyebrow">Вехи</span>
        {state.milestones.map((m) => <MilestoneCard key={m.key} m={m} />)}
      </div>
      <Decisions />
      {state.mechanics.charter && (
        <div className="stack sm">
          <span className="eyebrow">Договор команды</span>
          <Charter compact />
        </div>
      )}
      <Notices />
    </div>
  );
}

export function MilestoneCard({ m }: { m: Milestone }) {
  const { state, me, act, busy } = usePlay();
  const hier = state.team.condition === "hierarchy";
  const allowed = state.session.phase === "work" && (!hier || me.is_pm) && !me.away_until;
  const late = !m.closed_at && m.deadline && new Date(m.deadline).getTime() < new Date(state.session.now).getTime();
  const ready = !m.closed_at && m.tasks > 0 && m.done >= m.tasks;
  const closedLate = m.closed_at && m.deadline && new Date(m.closed_at) > new Date(m.deadline);
  return (
    <div className={`milestone ${m.closed_at ? "closed" : ""} ${late ? "late" : ""}`}>
      <div className="row between top">
        <div className="stack xs" style={{ minWidth: 0 }}>
          <span className="row tight"><Flag size={14} /><strong>{m.key}</strong></span>
          <span className="small soft">{m.title}</span>
        </div>
        {m.closed_at ? (
          <span className={`chip ${closedLate ? "warn" : "good"}`}>{closedLate ? "закрыта с опозданием" : "закрыта в срок"}</span>
        ) : m.deadline ? (
          <span className={`chip lg ${late ? "bad" : "outline"}`} title={`Срок: ${clock(m.deadline)}`}>
            <CalendarClock size={13} /><Countdown to={m.deadline} serverNow={state.session.now} over="срок прошёл" />
          </span>
        ) : <span className="chip outline">срок с началом работы</span>}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="bar accent grow"><span style={{ width: `${m.tasks ? (m.done / m.tasks) * 100 : 0}%` }} /></div>
        <span className="tiny muted nowrap">{m.done} / {m.tasks}</span>
      </div>
      {allowed && !m.closed_at && (
        <div className="row wrap tight">
          <button className={`btn sm ${ready ? "accent" : ""}`} disabled={busy || !ready} onClick={() => act(`/api/p/milestones/${m.key}/close`, {}, `Веха ${m.key} закрыта`)}>
            <Flag size={14} />Закрыть веху
          </button>
          {m.deadline && (
            <>
              <button className="btn sm ghost" disabled={busy} title="Договориться с клиентом о переносе"
                onClick={() => act(`/api/p/milestones/${m.key}/deadline`, { minutes: Math.max(1, Math.round(5 * state.session.time_scale)) }, "Срок сдвинут")}>
                +{Math.max(1, Math.round(5 * state.session.time_scale))} мин
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Decisions() {
  const { state, people } = usePlay();
  const [open, setOpen] = useState(false);
  const canLog = state.session.phase === "work";
  return (
    <div className="stack sm">
      <div className="row between">
        <span className="eyebrow">Журнал решений</span>
        {canLog && <button className="btn xs" onClick={() => setOpen(true)}><Plus size={13} />Записать</button>}
      </div>
      {state.decisions.length === 0 && <span className="small muted">Фиксируйте здесь развилки: что решали, что выбрали и почему. Это станет частью разбора.</span>}
      {state.decisions.map((d) => {
        const by = people[d.proposed_by];
        return (
          <div key={d.decision_id} className={`fact ${d.key_decision ? "shared" : ""}`}>
            <span className="bar-v" style={{ background: d.key_decision ? "var(--accent)" : "var(--ink-3)" }} />
            <div className="stack xs grow">
              <span className="small"><strong>{d.title ?? "Решение"}</strong>{d.case_id && !d.key_decision && <span className="muted"> · {d.case_id}</span>}</span>
              <span className="small">→ {d.chosen}{d.alternatives.length > 0 && !d.key_decision && <span className="muted"> (из: {d.alternatives.join(", ")})</span>}</span>
              {d.rationale && <span className="tiny soft">«{d.rationale}»</span>}
              <span className="row tight tiny muted">{by && <PersonTile person={by} size="xs" />}{shortName(by)} · {clock(d.decided_at)}</span>
            </div>
          </div>
        );
      })}
      <DecisionModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function DecisionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, me, act, busy } = usePlay();
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState("");
  const [alts, setAlts] = useState("");
  const [why, setWhy] = useState("");
  const [by, setBy] = useState(me.participant_id);
  const [task, setTask] = useState("");
  const submit = async () => {
    const ok = await act("/api/p/decisions", {
      title, chosen, rationale: why || null, proposed_by: by, case_key: task || null,
      alternatives: alts.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
    }, "Решение записано");
    if (ok) { setTitle(""); setChosen(""); setAlts(""); setWhy(""); setTask(""); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack lg">
        <div className="panel-title"><NotebookPen size={20} /><h2 style={{ fontSize: 22 }}>Записать решение</h2></div>
        <div className="field"><label>Что решали</label>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Например: кто берёт срочный заказ" autoFocus /></div>
        <div className="field"><label>Что выбрали</label>
          <input className="input" value={chosen} maxLength={300} onChange={(e) => setChosen(e.target.value)} placeholder="Например: Илья, остальные помогают с контролем" /></div>
        <div className="field"><label>Какие были варианты <span className="muted">(через запятую)</span></label>
          <input className="input" value={alts} onChange={(e) => setAlts(e.target.value)} /></div>
        <div className="grid-2">
          <div className="field"><label>Кто предложил</label>
            <Select label="Кто предложил" value={by} options={personOptions(state.roster, me.participant_id)} onChange={setBy} /></div>
          <div className="field"><label>Задача <span className="muted">(если про неё)</span></label>
            <Select label="Задача" value={task || NOBODY} options={[nobodyOption("Не про задачу"), ...taskOptions(state.tasks)]} onChange={(v) => setTask(v === NOBODY ? "" : v)} /></div>
        </div>
        <div className="field"><label>Почему</label>
          <textarea className="textarea" value={why} maxLength={2000} onChange={(e) => setWhy(e.target.value)} /></div>
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || !title.trim() || !chosen.trim()} onClick={() => void submit()}>Записать</button>
        </div>
      </div>
    </Modal>
  );
}

function Notices() {
  const { state } = usePlay();
  const items = state.notices.filter((n) => n.kind !== "achievement").slice(0, 12);
  if (!items.length) return null;
  return (
    <div className="stack sm">
      <span className="eyebrow">События</span>
      {items.map((n) => {
        const I = NOTICE_ICONS[n.kind] ?? Bell;
        return (
          <div key={n.notice_id} className={`notice ${n.kind}`}>
            <span className="ico"><I size={15} /></span>
            <div className="grow"><div className="title">{n.title}</div>{n.body && <div className="body">{n.body}</div>}</div>
            <span className="tiny muted nowrap">{clock(n.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}
