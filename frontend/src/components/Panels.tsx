import { useEffect, useRef, useState } from "react";
import { clock, initials, personLabel } from "../format";
import type { Decision, Milestone, Notice, Person, ScenarioPublic } from "../types";
import { Avatar, Icon } from "./ui";

/* ---------------------------------------------------------------- вехи */

export function Milestones({ items, serverNow, canManage, onClose, onShift, busy }: {
  items: Milestone[]; serverNow: string; canManage: boolean; busy?: boolean;
  onClose?: (key: string) => void; onShift?: (key: string, minutes: number) => void;
}) {
  const now = new Date(serverNow).getTime();
  return (
    <div className="stack">
      {items.map((m) => {
        const deadline = m.deadline ? new Date(m.deadline).getTime() : null;
        const closed = !!m.closed_at;
        const late = deadline !== null && (closed ? new Date(m.closed_at!).getTime() > deadline : now > deadline);
        const left = deadline !== null ? Math.round((deadline - now) / 60000) : null;
        const ready = m.tasks > 0 && m.done === m.tasks;
        return (
          <div key={m.key} className="stack sm" style={{ paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
            <div className="row between top">
              <div className="stack sm grow">
                <div className="row" style={{ gap: 8 }}>
                  <span className="mono tiny muted">{m.key}</span>
                  {closed ? (
                    <span className={`chip ${late ? "warn" : "good"}`}><Icon name={late ? "alert" : "check"} size={12} />{late ? "закрыта с опозданием" : "закрыта в срок"}</span>
                  ) : late ? (
                    <span className="chip bad"><Icon name="alert" size={12} />срок прошёл</span>
                  ) : left !== null ? (
                    <span className="chip outline"><Icon name="clock" size={12} />{left} мин</span>
                  ) : null}
                </div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{m.title}</span>
              </div>
              <span className="small muted nowrap">до {clock(m.deadline)}</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="progress grow"><span style={{ width: `${m.tasks ? (m.done / m.tasks) * 100 : 0}%` }} /></div>
              <span className="tiny muted nowrap">{m.done}/{m.tasks}</span>
            </div>
            {canManage && !closed && (
              <div className="row wrap" style={{ gap: 6 }}>
                <button className="btn sm primary" disabled={busy || !ready} onClick={() => onClose?.(m.key)}
                  title={ready ? "" : "Сначала сдайте все задачи вехи"}>
                  <Icon name="flag" size={14} />Закрыть веху
                </button>
                <button className="btn sm ghost" disabled={busy || !m.deadline} onClick={() => onShift?.(m.key, 5)}>+5 мин</button>
                <button className="btn sm ghost" disabled={busy || !m.deadline} onClick={() => onShift?.(m.key, -5)}>−5 мин</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- роль */

export function RoleCard({ scenario }: { scenario: ScenarioPublic }) {
  const role = scenario.my_role;
  return (
    <div className="stack">
      {role && (
        <div className="stack sm">
          <div className="row"><Avatar lg me text={initials({ display_name: null, role_title: role.title })} />
            <div><div style={{ fontWeight: 650, textTransform: "capitalize" }}>{role.title}</div>
              <div className="small muted">{role.department}</div></div>
          </div>
          <p className="small soft">{role.summary}</p>
        </div>
      )}
      <div className="stack sm">
        <div className="section-title">Знаете только вы</div>
        {role?.facts?.map((f, i) => <div key={i} className="fact secret"><span className="mark" /><span>{f}</span></div>)}
      </div>
      <div className="stack sm">
        <div className="section-title">Знают все</div>
        {scenario.shared_facts.map((f, i) => <div key={i} className="fact"><span className="mark" /><span>{f}</span></div>)}
      </div>
      <p className="tiny muted">Лучшее решение видно, только если сложить факты всех ролей. Делитесь ими вслух.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- решения */

export function DecisionLog({ scenario, decisions, roster, me, canKey, onSubmit, busy }: {
  scenario: ScenarioPublic; decisions: Decision[]; roster: Person[]; me: string; canKey: boolean; busy?: boolean;
  onSubmit?: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const people = Object.fromEntries(roster.map((p) => [p.participant_id, p]));
  const d = scenario.decision;
  const keyDone = decisions.find((x) => x.key_decision);
  const [mode, setMode] = useState<"key" | "other">(keyDone ? "other" : "key");
  const [chosen, setChosen] = useState("");
  const [title, setTitle] = useState("");
  const [alts, setAlts] = useState("");
  const [rationale, setRationale] = useState("");
  const [by, setBy] = useState(me);
  const [caseKey, setCaseKey] = useState("");

  const submit = async () => {
    const body = mode === "key"
      ? { key_decision: true, chosen, rationale, proposed_by: by }
      : { title, chosen, rationale, proposed_by: by, alternatives: alts.split(/[;\n]/).map((s) => s.trim()).filter(Boolean), case_key: caseKey.trim().toUpperCase() || null };
    if (await onSubmit?.(body)) { setChosen(""); setTitle(""); setAlts(""); setRationale(""); setCaseKey(""); }
  };

  return (
    <div className="stack">
      {onSubmit && (
        <div className="stack">
          <div className="segmented" role="group">
            <button aria-pressed={mode === "key"} onClick={() => setMode("key")}>Ключевое решение</button>
            <button aria-pressed={mode === "other"} onClick={() => setMode("other")}>Другое</button>
          </div>
          {mode === "key" ? (
            <div className="stack">
              <p style={{ fontWeight: 600 }}>{d.question}</p>
              {keyDone && <p className="small muted">Уже принято: вариант {keyDone.chosen}. Новая запись заменит его в разборе.</p>}
              {!canKey && <p className="small muted">В иерархии ключевое решение записывает руководитель.</p>}
              <div className="stack sm">
                {d.options.map((o) => (
                  <label key={o.id} className="pick" style={{ padding: "10px 12px" }} aria-pressed={chosen === o.id}>
                    <input type="radio" name="opt" className="sr-only" checked={chosen === o.id} onChange={() => setChosen(o.id)} />
                    <span className="avatar">{o.id}</span>{o.title}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="field"><label>Что решали</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: от чего отказаться при урезании бюджета" /></div>
              <div className="field"><label>Какие были варианты <span className="muted">(через ;)</span></label>
                <input className="input" value={alts} onChange={(e) => setAlts(e.target.value)} placeholder="push-уведомления; личный кабинет" /></div>
              <div className="field"><label>Что выбрали</label>
                <input className="input" value={chosen} onChange={(e) => setChosen(e.target.value)} /></div>
              <div className="field"><label>Задача <span className="muted">(необязательно)</span></label>
                <input className="input mono" value={caseKey} onChange={(e) => setCaseKey(e.target.value)} placeholder="T08" /></div>
            </div>
          )}
          <div className="field"><label>Кто предложил</label>
            <select className="select" value={by} onChange={(e) => setBy(e.target.value)}>
              {roster.map((p) => <option key={p.participant_id} value={p.participant_id}>{personLabel(p)}</option>)}
            </select></div>
          <div className="field"><label>Почему так решили</label>
            <textarea className="textarea" value={rationale} onChange={(e) => setRationale(e.target.value)} style={{ minHeight: 72 }} /></div>
          <button className="btn primary" disabled={busy || !chosen || (mode === "other" && !title) || (mode === "key" && !canKey)} onClick={submit}>
            Записать решение
          </button>
        </div>
      )}
      <div className="stack sm">
        <div className="section-title">Журнал решений</div>
        {decisions.length === 0 && <p className="small muted">Пока пусто.</p>}
        {decisions.map((x) => (
          <div key={x.decision_id} className="fact" style={{ flexDirection: "column", gap: 4 }}>
            <div className="row between"><strong style={{ fontSize: 14 }}>{x.key_decision ? d.title : x.alternatives.length ? x.alternatives.join(" / ") : "Решение"}</strong>
              <span className="tiny muted">{clock(x.decided_at)}</span></div>
            <span>Выбрано: <strong>{x.chosen}</strong>{x.case_id && !x.key_decision ? <span className="muted"> · {x.case_id}</span> : null}</span>
            {x.rationale && <span className="small soft">{x.rationale}</span>}
            <span className="tiny muted">Предложил(а): {personLabel(people[x.proposed_by])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- сообщения */

export function Notices({ items }: { items: Notice[] }) {
  const seen = useRef<Set<number>>(new Set(items.map((n) => n.notice_id)));
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    const incoming = items.filter((n) => !seen.current.has(n.notice_id)).map((n) => n.notice_id);
    if (incoming.length) {
      incoming.forEach((id) => seen.current.add(id));
      setFresh(new Set(incoming));
      const t = window.setTimeout(() => setFresh(new Set()), 6000);
      return () => window.clearTimeout(t);
    }
  }, [items]);
  if (!items.length) return <p className="small muted">Сообщений от ведущего пока нет.</p>;
  return (
    <div className="stack sm">
      {items.map((n) => (
        <div key={n.notice_id} className={`notice ${fresh.has(n.notice_id) ? "fresh" : ""} ${n.roles ? "info" : ""}`}>
          <span className="icon"><Icon name={n.roles ? "lock" : "bolt"} /></span>
          <div className="stack sm grow">
            <div className="row between"><strong style={{ fontSize: 14 }}>{n.title}</strong><span className="tiny muted">{clock(n.created_at)}</span></div>
            {n.body && <span className="small">{n.body}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
