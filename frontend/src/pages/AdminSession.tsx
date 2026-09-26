import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, usePoll } from "../api";
import { Board } from "../components/Board";
import { Debrief } from "../components/Debrief";
import { DecisionLog, Milestones, Notices } from "../components/Panels";
import { Avatar, Countdown, Empty, Icon, Modal, useAction, useToast } from "../components/ui";
import { PHASES, clock, condColor, initials, personLabel, phaseTitle } from "../format";
import type { BoardData, Condition, Debrief as DebriefData, Person, Phase, SessionInfo } from "../types";
import { AdminShell, PHASE_HINT, useAdminGuard, useAdminToken } from "./Admin";

interface Live extends BoardData {
  team: { team_id: string; join_code: string; label: string; condition: Condition; condition_title: string; scenario_version: string };
  session: SessionInfo;
  notes: string;
  roster: (Person & { surveys: string[] })[];
  pending_devices: number;
  injects: { key: string; title: string; hint: string; fired: number; last: string | null }[];
  decision: { key: string; title: string; question: string; options: { id: string; title: string }[]; correct: string };
  feed: { event_id: number; ts: string; activity: string; case_id: string; resource: string; attrs: Record<string, unknown> }[];
}

type Tab = "board" | "people" | "injects" | "feed" | "debrief" | "settings";

export default function AdminSession() {
  const { team = "", session = "" } = useParams();
  const token = useAdminToken()!;
  const base = `/api/admin/sessions/${team}/${session}`;
  const { data, error, reload } = usePoll(() => api<Live>(base, { token }), 2000, [base, token]);
  const [tab, setTab] = useState<Tab>("board");
  const [confirm, setConfirm] = useState<Phase | null>(null);
  const [fire, setFire] = useState<Live["injects"][number] | null>(null);
  const { run, busy } = useAction();
  const toast = useToast();
  const guard = useAdminGuard(error?.status);
  if (guard) return guard;
  if (!data) return <AdminShell><Empty title={error ? error.message : "Загрузка…"} icon="clock" /></AdminShell>;

  const phaseIdx = PHASES.findIndex((p) => p.key === data.session.phase);
  const next = PHASES[phaseIdx + 1];
  const surveyPhase = ["entry", "pulse", "exit"].includes(data.session.phase) ? data.session.phase : null;
  const answered = surveyPhase ? data.roster.filter((r) => r.surveys.includes(surveyPhase)).length : null;
  const setPhase = (p: Phase) => run(async () => { await api(`${base}/phase`, { method: "POST", token, body: { phase: p } }); reload(); }, `Этап: ${phaseTitle(p)}`);
  const askPhase = (p: Phase) => {
    const idx = PHASES.findIndex((x) => x.key === p);
    if (idx < phaseIdx || p === "closed") setConfirm(p); else setPhase(p);
  };
  const people = Object.fromEntries(data.roster.map((p) => [p.participant_id, p]));

  return (
    <AdminShell wide>
      <div className="stack lg">
        {/* ---------- шапка сессии */}
        <div className="row between wrap top">
          <div className="stack sm">
            <Link to="/admin" className="small row" style={{ gap: 4 }}><Icon name="back" size={14} />Все команды</Link>
            <div className="row wrap" style={{ gap: 10 }}>
              <h1 style={{ fontSize: 32 }}>{data.team.team_id} · {data.session.session_id}</h1>
              <span className="chip lg"><span className="swatch" style={{ background: condColor(data.team.condition) }} />{data.team.condition_title}</span>
            </div>
            <span className="soft">{data.team.label || "без подписи"} · сценарий {data.team.scenario_version}</span>
          </div>
          <div className="card tight row" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 0 }}>
              <span className="tiny muted">Код для входа</span>
              <span className="join-code" style={{ fontSize: 30 }}>{data.team.join_code}</span>
            </div>
            <button className="btn ghost icon-btn" title="Скопировать" aria-label="Скопировать код"
              onClick={() => { navigator.clipboard?.writeText(data.team.join_code); toast("Код скопирован"); }}><Icon name="copy" /></button>
            {data.session.phase === "work" && (
              <div className="stack" style={{ gap: 0 }}>
                <span className="tiny muted">До конца</span>
                <Countdown startedAt={data.session.work_started_at} minutes={data.session.work_minutes} serverNow={data.session.now} />
              </div>
            )}
          </div>
        </div>

        {/* ---------- этапы */}
        <section className="card stack">
          <div className="stepper" role="list">
            {PHASES.map((p, i) => (
              <button key={p.key} role="listitem" className={`step ${i < phaseIdx ? "done" : ""} ${i === phaseIdx ? "current" : ""}`}
                disabled={busy} onClick={() => i !== phaseIdx && askPhase(p.key)}>
                <span className="num">{i + 1}</span>{p.short}
              </button>
            ))}
          </div>
          <div className="row between wrap">
            <div className="stack" style={{ gap: 2 }}>
              <strong>{phaseTitle(data.session.phase)}</strong>
              <span className="small soft">{PHASE_HINT[data.session.phase]}</span>
            </div>
            <div className="row wrap">
              {answered !== null && <span className="chip lg accent">ответили {answered} из {data.roster.length}</span>}
              {next && (
                <button className="btn primary" disabled={busy} onClick={() => askPhase(next.key)}>
                  {next.title} <Icon name="arrow" />
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="stats">
          <div className="stat"><div className="k">Участники</div><div className="v">{data.roster.length}</div>
            <div className="d">{data.pending_devices ? `ещё ${data.pending_devices} на экране согласия` : "все дали согласие"}</div></div>
          <div className="stat"><div className="k">Задач сдано</div><div className="v">{(data.tasks ?? []).filter((t) => t.stage === "Сдача").length}<small>из {(data.tasks ?? []).length}</small></div></div>
          <div className="stat"><div className="k">Вехи</div><div className="v">{data.milestones.filter((m) => m.closed_at).length}<small>из {data.milestones.length}</small></div></div>
          <div className="stat"><div className="k">Ключевое решение</div>
            <div className="v">{data.decisions.find((d) => d.key_decision)?.chosen ?? "—"}</div>
            <div className="d">лучший вариант — {data.decision.correct}</div></div>
          <div className="stat"><div className="k">Событий в журнале</div><div className="v">{data.feed.length >= 40 ? "40+" : data.feed.length}</div>
            <div className="d">последнее в {clock(data.feed[0]?.ts)}</div></div>
        </div>

        {/* ---------- вкладки */}
        <div className="tabs" role="tablist">
          {([["board", "Доска"], ["people", "Участники"], ["injects", "Вбросы"], ["feed", "Лента"], ["debrief", "Разбор"], ["settings", "Настройки и заметки"]] as [Tab, string][]).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>
          ))}
        </div>

        {tab === "board" && (
          <div className="layout-work">
            <Board tasks={data.tasks} roster={data.roster} condition={data.team.condition} session={data.session} viewer={null} />
            <aside className="sidebar">
              <section className="card"><div className="card-head"><h3>Вехи</h3></div>
                <Milestones items={data.milestones} serverNow={data.session.now} canManage={false} /></section>
              <section className="card"><div className="card-head"><h3>Сообщения команде</h3></div><Notices items={data.notices} /></section>
            </aside>
          </div>
        )}

        {tab === "people" && (
          <section className="card">
            {data.roster.length === 0 ? <Empty title="Пока никто не вошёл" icon="users">Покажите команде код {data.team.join_code}.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Участник</th><th>Роль</th><th>Код</th><th>Вход</th><th>Пульс</th><th>Выход</th></tr></thead>
                  <tbody>
                    {data.roster.map((p) => (
                      <tr key={p.participant_id}>
                        <td><div className="row"><Avatar text={initials(p)} />{p.display_name || <span className="muted">без имени</span>}</div></td>
                        <td style={{ textTransform: "capitalize" }}>{p.role_title}</td>
                        <td className="mono small">{p.participant_id}</td>
                        {["entry", "pulse", "exit"].map((ph) => (
                          <td key={ph}>{p.surveys.includes(ph) ? <span className="chip good"><Icon name="check" size={12} />есть</span> : <span className="muted">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "injects" && (
          <div className="stack">
            {data.session.phase !== "work" && <div className="notice info"><span className="icon"><Icon name="info" /></span>Вбросы обычно запускают в рабочей фазе.</div>}
            <div className="grid-2">
              {data.injects.map((i) => (
                <div key={i.key} className="card stack">
                  <div className="row between top">
                    <div className="stack" style={{ gap: 2 }}><h3>{i.title}</h3><span className="small soft">{i.hint}</span></div>
                    <Icon name="bolt" size={20} />
                  </div>
                  <div className="row between">
                    <span className="small muted">{i.fired ? `запущен ${i.fired}× · ${clock(i.last)}` : "ещё не запускался"}</span>
                    <button className={`btn ${i.fired ? "" : "primary"}`} disabled={busy} onClick={() => setFire(i)}>
                      <Icon name="play" />{i.fired ? "Ещё раз" : "Запустить"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "feed" && (
          <section className="card">
            {data.feed.length === 0 ? <Empty title="Событий пока нет" icon="file" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Время</th><th>Событие</th><th>Объект</th><th>Кто</th><th>Детали</th></tr></thead>
                  <tbody>
                    {data.feed.map((e) => (
                      <tr key={e.event_id}>
                        <td className="mono small">{new Date(e.ts).toLocaleTimeString("ru-RU")}</td>
                        <td style={{ fontWeight: 560 }}>{e.activity}</td>
                        <td className="mono small">{e.case_id}</td>
                        <td>{people[e.resource] ? personLabel(people[e.resource]) : e.resource}</td>
                        <td className="small muted">{Object.entries(e.attrs ?? {}).filter(([k]) => k !== "deadline").map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "debrief" && <AdminDebrief base={base} token={token} live={data} />}
        {tab === "settings" && <Settings base={base} token={token} live={data} reload={reload} />}
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <div className="stack lg">
            <h3>Перейти к этапу «{phaseTitle(confirm)}»?</h3>
            <p className="soft">{confirm === "closed" ? "Сессия будет завершена. Участники увидят экран благодарности." :
              "Это шаг назад. Экраны участников переключатся сразу. Уже собранные данные не пропадут."}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Отмена</button>
              <button className="btn primary" onClick={() => { setPhase(confirm); setConfirm(null); }}>Перейти</button>
            </div>
          </div>
        </Modal>
      )}
      {fire && (
        <Modal onClose={() => setFire(null)}>
          <div className="stack lg">
            <div className="row"><Icon name="bolt" size={22} /><h3>Вброс: {fire.title}</h3></div>
            <p className="soft">{fire.hint}</p>
            <p className="small">Команда сразу увидит сообщение, а в журнале появится метка вброса.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setFire(null)}>Отмена</button>
              <button className="btn primary" onClick={() => {
                const i = fire; setFire(null);
                run(async () => { await api(`${base}/injects/${i.key}`, { method: "POST", token }); reload(); }, "Вброс запущен");
              }}><Icon name="play" />Запустить</button>
            </div>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function AdminDebrief({ base, token, live }: { base: string; token: string; live: Live }) {
  const { data, error } = usePoll(() => api<DebriefData>(`${base}/debrief`, { token }), 5000, [base, token]);
  return (
    <div className="stack lg">
      <div className="notice info"><span className="icon"><Icon name="info" /></span>
        <span>Команда увидит этот же разбор на своих экранах, когда вы переключите этап на «Дебрифинг».</span></div>
      {data ? <Debrief data={data} /> : <Empty title={error ? error.message : "Считаем метрики…"} icon="chart" />}
      <section className="card">
        <div className="card-head"><h3>Журнал решений</h3></div>
        <DecisionLog scenario={{ decision: live.decision } as never} decisions={live.decisions} roster={live.roster} me="" canKey={false} />
      </section>
    </div>
  );
}

function Settings({ base, token, live, reload }: { base: string; token: string; live: Live; reload: () => void }) {
  const [work, setWork] = useState(live.session.work_minutes);
  const [wip, setWip] = useState(live.session.wip_limit);
  const [sprint, setSprint] = useState(live.session.sprint_minutes);
  const [notes, setNotes] = useState(live.notes);
  const [dirty, setDirty] = useState(false);
  const { run, busy } = useAction();
  useEffect(() => { if (!dirty) setNotes(live.notes); }, [live.notes, dirty]);

  const save = (body: Record<string, unknown>, msg: string) =>
    run(async () => { await api(base, { method: "PATCH", token, body }); reload(); }, msg);

  return (
    <div className="grid-2">
      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h3>Параметры сессии</h3></div>
        <div className="field"><label>Длительность рабочей фазы, мин</label>
          <input type="number" className="input" min={5} max={240} value={work} onChange={(e) => setWork(Number(e.target.value))} /></div>
        {live.team.condition === "kanban" && (
          <div className="field"><label>Лимит незавершённой работы на этап (WIP)</label>
            <input type="number" className="input" min={1} max={20} value={wip} onChange={(e) => setWip(Number(e.target.value))} /></div>
        )}
        {live.team.condition === "sprints" && (
          <div className="field"><label>Длина спринта, мин</label>
            <input type="number" className="input" min={3} max={120} value={sprint} onChange={(e) => setSprint(Number(e.target.value))} /></div>
        )}
        <button className="btn primary" disabled={busy} style={{ alignSelf: "flex-start" }}
          onClick={() => save({ work_minutes: work, wip_limit: wip, sprint_minutes: sprint }, "Параметры сохранены")}>Сохранить</button>
        <p className="tiny muted">Чтобы команды были сопоставимы, меняйте параметры одинаково для всех групп серии.</p>
      </section>
      <section className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}><h3>Заметки ведущего</h3><span className="hint">сохраняются в данные сессии</span></div>
        <textarea className="textarea" style={{ minHeight: 220 }} value={notes}
          placeholder="Что заметили на дебрифинге: кто взял лидерство, где спорили, как реагировали на вбросы…"
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
        <button className="btn primary" disabled={busy || !dirty} style={{ alignSelf: "flex-start" }}
          onClick={async () => { if (await save({ notes }, "Заметки сохранены")) setDirty(false); }}>Сохранить заметки</button>
      </section>
    </div>
  );
}
