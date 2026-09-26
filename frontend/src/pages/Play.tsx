import { useCallback, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { TOKENS, api, store, usePoll } from "../api";
import { Board, type TaskAction } from "../components/Board";
import { Debrief } from "../components/Debrief";
import { DecisionLog, Milestones, Notices, RoleCard } from "../components/Panels";
import { Survey } from "../components/Survey";
import { Avatar, Brand, Countdown, Empty, Icon, Logo, ThemeToggle, useAction } from "../components/ui";
import { condColor, initials, personLabel, phaseTitle } from "../format";
import type { Debrief as DebriefData, ParticipantState, Role } from "../types";

export default function Play() {
  const token = store.get(TOKENS.participant);
  return token ? <PlayScreen token={token} /> : <Navigate to="/" replace />;
}

function PlayScreen({ token }: { token: string }) {
  const { data, error, reload } = usePoll(() => api<ParticipantState>("/api/p/state", { token }), 2000, [token]);

  if (error?.status === 401) {
    store.del(TOKENS.participant);
    return <Gone />;
  }
  if (!data) return <Loading error={error?.message} />;

  const { me, session, team } = data;
  return (
    <>
      <header className="topbar">
        <Brand sub={data.company.title} />
        <span className="chip lg hide-sm" style={{ color: condColor(team.condition) }}><span className="dot" />
          <span style={{ color: "var(--ink-2)" }}>{team.condition_title}</span></span>
        <div className="spacer" />
        {session.phase === "work" && <Countdown startedAt={session.work_started_at} minutes={session.work_minutes} serverNow={session.now} />}
        <span className="chip outline lg hide-sm">{phaseTitle(session.phase)}</span>
        {me && <Avatar me text={initials(me)} title={personLabel(me)} />}
        <ThemeToggle />
      </header>
      {!me ? <Consent state={data} token={token} reload={reload} />
        : session.phase === "lobby" ? <Lobby state={data} />
        : ["entry", "pulse", "exit"].includes(session.phase) ? <SurveyPhase state={data} token={token} reload={reload} />
        : session.phase === "briefing" ? <Briefing state={data} />
        : session.phase === "work" ? <Work state={data} token={token} reload={reload} />
        : session.phase === "debrief" ? <ParticipantDebrief token={token} />
        : <Closed />}
    </>
  );
}

function Loading({ error }: { error?: string }) {
  return <main className="page narrow"><Empty title={error ? "Нет связи с сервером" : "Загрузка…"} icon="clock">{error}</Empty></main>;
}

function Gone() {
  return (
    <main className="page narrow">
      <div className="card"><Empty title="Сессия не найдена" icon="info">
        Возможно, вы отказались от участия или ведущий пересоздал команду.
        <div style={{ marginTop: 16 }}><Link className="btn primary" to="/">Ввести код команды</Link></div>
      </Empty></div>
    </main>
  );
}

/* ---------------------------------------------------------------- согласие и роль */

function Consent({ state, token, reload }: { state: ParticipantState; token: string; reload: () => void }) {
  const [role, setRole] = useState<string>("");
  const [name, setName] = useState("");
  const { run, busy } = useAction();
  const roles = state.roles ?? [];

  const decide = (agree: boolean) => run(async () => {
    await api("/api/p/consent", { method: "POST", token, body: { agree, role_slug: role || null, display_name: name.trim() || null } });
    if (!agree) store.del(TOKENS.participant);
    reload();
  });

  return (
    <main className="page narrow stack lg">
      <div className="stack sm">
        <span className="section-title">Команда {state.team.label || state.team.team_id}</span>
        <h1>Добро пожаловать в «{state.company.title}»</h1>
        <p className="soft">{state.company.description}</p>
      </div>
      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h3>Согласие на участие</h3><Icon name="lock" /></div>
        <ul className="stack sm" style={{ margin: 0, paddingLeft: 18 }}>
          {state.consent_text?.map((t, i) => <li key={i} className="soft">{t}</li>)}
        </ul>
      </section>
      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h3>Ваша роль</h3><span className="hint">договоритесь за столом, кто кем будет</span></div>
        <div className="grid-2" style={{ gap: 10 }}>
          {roles.map((r: Role) => {
            const full = (r.taken ?? 0) >= r.capacity;
            return (
              <button key={r.slug} className="pick" aria-pressed={role === r.slug} disabled={full}
                style={{ padding: 14, alignItems: "flex-start", textAlign: "left", opacity: full ? 0.5 : 1, flexDirection: "column", gap: 4 }}
                onClick={() => setRole(r.slug)}>
                <span className="row between" style={{ width: "100%" }}>
                  <strong style={{ textTransform: "capitalize" }}>{r.title}</strong>
                  <span className="tiny" style={{ opacity: 0.7 }}>{full ? "занято" : r.capacity > 1 ? `${r.taken ?? 0}/${r.capacity}` : ""}</span>
                </span>
                <span className="small" style={{ opacity: 0.75 }}>{r.department}</span>
                <span className="small" style={{ opacity: 0.85, fontWeight: 400 }}>{r.summary}</span>
              </button>
            );
          })}
        </div>
        <div className="field">
          <label htmlFor="name">Как вас называть в команде <span className="muted">(необязательно)</span></label>
          <input id="name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Аня" />
          <span className="tiny muted">Имя видят только ваши коллеги по команде. В данные исследования оно не попадает.</span>
        </div>
      </section>
      <div className="row between wrap">
        <button className="btn ghost" disabled={busy} onClick={() => decide(false)}>Не участвовать</button>
        <button className="btn primary lg" disabled={busy || !role} onClick={() => decide(true)}>
          Согласен(на), начать <Icon name="arrow" />
        </button>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- ожидание */

function Lobby({ state }: { state: ParticipantState }) {
  return (
    <main className="page narrow stack lg">
      <div className="stack sm">
        <span className="section-title">Сбор команды</span>
        <h1>Ждём, пока соберутся все</h1>
        <p className="soft">Ведущий начнёт, когда команда будет в сборе. Экран обновится сам.</p>
      </div>
      <Roster state={state} />
    </main>
  );
}

function Roster({ state }: { state: ParticipantState }) {
  return (
    <div className="grid-3" style={{ gap: 10 }}>
      {state.roster?.map((p) => (
        <div key={p.participant_id} className="card tight row">
          <Avatar lg me={p.participant_id === state.me?.participant_id} text={initials(p)} />
          <div className="stack" style={{ gap: 0 }}>
            <strong>{p.display_name || p.role_title}</strong>
            <span className="small muted" style={{ textTransform: "capitalize" }}>{p.role_title}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SurveyPhase({ state, token, reload }: { state: ParticipantState; token: string; reload: () => void }) {
  const { run, busy } = useAction();
  const spec = state.survey;
  if (!spec) return <Lobby state={state} />;
  if (spec.done) {
    return (
      <main className="page narrow">
        <div className="card"><Empty title="Спасибо, ответы сохранены" icon="check">Ждём остальных — ведущий переключит этап.</Empty></div>
      </main>
    );
  }
  return (
    <main className="page narrow">
      <Survey spec={spec} roster={state.roster ?? []} me={state.me!.participant_id} busy={busy}
        onSubmit={(body) => run(async () => { await api("/api/p/survey", { method: "POST", token, body }); reload(); }, "Ответы сохранены")} />
    </main>
  );
}

/* ---------------------------------------------------------------- брифинг */

function Briefing({ state }: { state: ParticipantState }) {
  const sc = state.scenario!;
  return (
    <main className="page stack lg">
      <div className="stack sm">
        <span className="section-title">Брифинг</span>
        <h1>Компания «{sc.title}»</h1>
      </div>
      <div className="layout-work">
        <div className="stack lg">
          <section className="card stack">
            {sc.legend.map((p, i) => <p key={i} style={{ fontSize: 16 }}>{p}</p>)}
          </section>
          <section className="card stack">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <h3>Как вы работаете: {sc.condition.title}</h3>
              <span className="chip" style={{ color: condColor(sc.condition.key) }}><span className="dot" /></span>
            </div>
            <ol className="stack sm" style={{ margin: 0, paddingLeft: 20 }}>
              {sc.condition.rules.map((r, i) => <li key={i}>{r}</li>)}
            </ol>
          </section>
          <section className="card stack">
            <h3>Как устроена работа</h3>
            <p className="soft">Задачи проходят этапы: <strong>Анализ → Проектирование → Исполнение → Контроль → Сдача</strong>.
              Чтобы работать над задачей, возьмите её в работу. Закончив, передайте на следующий этап.
              Если на контроле что-то не так, верните задачу на доработку — это нормальная часть процесса.</p>
            <p className="soft">Обсуждайте всё вслух. Система записывает только результат: кто, что и когда сделал.</p>
          </section>
          <section className="card stack sm">
            <h3>Команда</h3>
            <Roster state={state} />
          </section>
        </div>
        <aside className="sidebar">
          <section className="card"><div className="card-head"><h3>Ваша роль</h3></div><RoleCard scenario={sc} /></section>
        </aside>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- работа */

type Tab = "milestones" | "role" | "decisions" | "notices";

function Work({ state, token, reload }: { state: ParticipantState; token: string; reload: () => void }) {
  const { run, busy } = useAction();
  const [tab, setTab] = useState<Tab>("milestones");
  const [seenNotices, setSeenNotices] = useState(() => state.notices?.length ?? 0);
  const sc = state.scenario!;
  const me = state.me!;
  const hier = state.team.condition === "hierarchy";
  const unread = Math.max(0, (state.notices?.length ?? 0) - seenNotices);

  const act = useCallback((key: string, action: TaskAction, body?: Record<string, unknown>) =>
    run(async () => { await api(`/api/p/tasks/${key}/${action}`, { method: "POST", token, body: body ?? {} }); reload(); }),
  [run, token, reload]);

  const openTab = (t: Tab) => { setTab(t); if (t === "notices") setSeenNotices(state.notices?.length ?? 0); };
  const latest = state.notices?.[0];
  const sprintLeft = state.team.condition === "sprints" && state.session.work_started_at
    ? state.session.sprint_minutes - (((new Date(state.session.now).getTime() - new Date(state.session.work_started_at).getTime()) / 60000) % state.session.sprint_minutes)
    : null;

  return (
    <main className="page wide">
      <div className="layout-work">
        <div className="stack">
          <div className="row wrap between">
            <div className="row wrap" style={{ gap: 8 }}>
              <h2>Доска задач</h2>
              {state.team.condition === "kanban" && <span className="chip outline">лимит {state.session.wip_limit} задачи на этап</span>}
              {state.team.condition === "sprints" && <span className="chip accent">спринт {state.session.current_sprint}{sprintLeft !== null ? ` · ещё ~${Math.ceil(sprintLeft)} мин` : ""}</span>}
              {hier && <span className="chip outline">{me.is_pm ? "вы распределяете задачи" : "берите задачи, назначенные руководителем"}</span>}
            </div>
            <span className="small muted">Вы: {personLabel(me)}</span>
          </div>
          {latest && unread > 0 && (
            <button className="notice fresh" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => openTab("notices")}>
              <span className="icon"><Icon name="bolt" /></span>
              <div className="stack sm grow"><strong>{latest.title}</strong><span className="small">{latest.body}</span></div>
            </button>
          )}
          <Board tasks={state.tasks ?? []} roster={state.roster ?? []} condition={state.team.condition} session={state.session}
            viewer={{ participant_id: me.participant_id, is_pm: me.is_pm }} onAction={act} busy={busy} />
        </div>
        <aside className="sidebar">
          <div className="card tight" style={{ padding: 0 }}>
            <div className="tabs" role="tablist" style={{ padding: "0 8px" }}>
              {([["milestones", "Вехи"], ["role", "Роль"], ["decisions", "Решения"], ["notices", "Сообщения"]] as [Tab, string][]).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => openTab(k)}>
                  {t}{k === "notices" && unread > 0 && <span className="count">{unread}</span>}
                </button>
              ))}
            </div>
            <div style={{ padding: 16 }}>
              {tab === "milestones" && (
                <Milestones items={state.milestones ?? []} serverNow={state.session.now} busy={busy}
                  canManage={!hier || me.is_pm}
                  onClose={(k) => run(async () => { await api(`/api/p/milestones/${k}/close`, { method: "POST", token }); reload(); }, "Веха закрыта")}
                  onShift={(k, m) => run(async () => { await api(`/api/p/milestones/${k}/deadline`, { method: "POST", token, body: { minutes: m } }); reload(); }, "Срок перенесён")} />
              )}
              {tab === "role" && <RoleCard scenario={sc} />}
              {tab === "decisions" && (
                <DecisionLog scenario={sc} decisions={state.decisions ?? []} roster={state.roster ?? []} me={me.participant_id}
                  canKey={!hier || me.is_pm} busy={busy}
                  onSubmit={(body) => run(async () => { await api("/api/p/decisions", { method: "POST", token, body }); reload(); }, "Решение записано")} />
              )}
              {tab === "notices" && <Notices items={state.notices ?? []} />}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- разбор и финал */

function ParticipantDebrief({ token }: { token: string }) {
  const { data, error } = usePoll(() => api<DebriefData>("/api/p/debrief", { token }), 10000, [token]);
  return (
    <main className="page stack lg">
      <div className="stack sm">
        <span className="section-title">Дебрифинг</span>
        <h1>Так на самом деле шла ваша работа</h1>
        <p className="soft">Это не оценка людей, а картина процесса. Посмотрите, где задачи ждали, что возвращалось и через кого шла работа.</p>
      </div>
      {data ? <Debrief data={data} /> : <Empty title={error ? error.message : "Собираем картину…"} icon="chart" />}
    </main>
  );
}

function Closed() {
  return (
    <main className="page narrow">
      <div className="card stack lg" style={{ textAlign: "center", alignItems: "center", padding: 40 }}>
        <Logo size={72} />
        <h1>Спасибо за работу!</h1>
        <p className="soft">Сессия завершена. Каждый был фрагментом — вместе получилась картина.</p>
      </div>
    </main>
  );
}
