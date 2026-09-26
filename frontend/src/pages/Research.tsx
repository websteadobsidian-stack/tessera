import { useState } from "react";
import { Link } from "react-router-dom";
import { api, download, usePoll } from "../api";
import { ConditionBars, type ConditionMetric } from "../charts/Bars";
import { Empty, Icon, Modal, useAction } from "../components/ui";
import { conditionTitle, condColor, num, pct } from "../format";
import { AdminShell, useAdminGuard, useAdminToken } from "./Admin";

type Row = Record<string, number | string | null> & { team_id: string; session_id: string; condition: string; label: string };
interface ResearchData { sessions: Row[]; conditions: Record<string, Record<string, number | null>> }

const mins = (v: number) => `${num(v * 60)} мин`;
const METRICS: ConditionMetric[] = [
  { key: "waiting_hours_mean", title: "Время ожидания", hint: "среднее на задачу", format: mins, better: "lower" },
  { key: "rework_case_share", title: "Доля доработок", hint: "задачи с возвратом", format: pct, better: "lower" },
  { key: "cycle_hours_mean", title: "Время цикла", hint: "от анализа до сдачи", format: mins, better: "lower" },
  { key: "fitness_mean", title: "Соответствие эталону", hint: "упрощённый fitness", format: pct, better: "higher" },
  { key: "on_time_final", title: "Вехи в срок", hint: "по итоговому сроку", format: pct, better: "higher" },
  { key: "decision_correct", title: "Качество решения", hint: "доля команд с лучшим вариантом", format: pct, better: "higher" },
  { key: "handover_centralization", title: "Централизация передач", hint: "0 — равномерно, 1 — звезда", format: (v) => num(v, 2) },
  { key: "psych_safety_exit", title: "Психбезопасность", hint: "выходной замер, 1–7", format: (v) => num(v, 2), better: "higher" },
  { key: "workload_tlx", title: "Нагрузка (TLX)", hint: "пульс-опрос, 0–100", format: (v) => num(v, 0) },
];

const EXPORTS = [
  { name: "events.csv", title: "Журнал событий", desc: "CSV в формате пакета tessera" },
  { name: "events.xes", title: "Журнал в XES", desc: "IEEE 1849 — для PM4Py, ProM, Disco" },
  { name: "events.ocel.json", title: "Журнал в OCEL 2.0", desc: "задачи, вехи, участники, команды" },
  { name: "surveys.csv", title: "Ответы на опросы", desc: "все фазы, по пунктам" },
  { name: "nominations.csv", title: "Оценки коллег", desc: "сетевые вопросы" },
  { name: "decisions.csv", title: "Журнал решений", desc: "альтернативы и обоснования" },
  { name: "injects.csv", title: "Вбросы", desc: "метки времени событий сценария" },
  { name: "participants.csv", title: "Участники", desc: "только коды, роли и отделы" },
  { name: "sessions.csv", title: "Сессии", desc: "условия и версии сценария" },
];

export default function Research() {
  const token = useAdminToken()!;
  const { data, error } = usePoll(() => api<ResearchData>("/api/admin/research", { token }), 15000, [token]);
  const identity = usePoll(() => api<{ names: number }>("/api/admin/identity", { token }), 15000, [token]);
  const [purge, setPurge] = useState(false);
  const { run, busy } = useAction();
  const guard = useAdminGuard(error?.status);
  if (guard) return guard;

  const teams = data ? Object.values(data.conditions).reduce((s, c) => s + (c.teams ?? 0), 0) : 0;

  return (
    <AdminShell>
      <div className="stack lg">
        <div className="stack sm">
          <span className="section-title">Исследование</span>
          <h1>Сравнение методик</h1>
          <p className="soft" style={{ maxWidth: 760 }}>
            Средние по командам в каждом условии. Сценарий и вбросы у всех одинаковые, поэтому различия
            связаны с методикой. Пока команд мало, это пилот: смотрите на направление эффектов, а не на абсолютные числа.
          </p>
        </div>

        {!data ? <Empty title={error ? error.message : "Загрузка…"} icon="chart" /> : teams === 0 ? (
          <div className="card"><Empty title="Данных пока нет" icon="chart">Сравнение появится после первых сессий с движением задач.</Empty></div>
        ) : (
          <>
            <div className="legend">
              {Object.keys(data.conditions).length > 0 && ["kanban", "sprints", "hierarchy", "self_org"].map((c) => (
                <span key={c}><span className="swatch" style={{ background: condColor(c) }} />{conditionTitle(c)} · команд: {data.conditions[c]?.teams ?? 0}</span>
              ))}
            </div>
            <div className="grid-3">
              {METRICS.map((m) => <ConditionBars key={m.key} data={data.conditions} metric={m} />)}
            </div>
          </>
        )}

        {data && data.sessions.length > 0 && (
          <section className="card">
            <div className="card-head"><h3>Все сессии</h3><span className="hint">таблица значений под графиками</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>Сессия</th><th>Методика</th><th className="num">Участн.</th><th className="num">Задач</th><th className="num">Ожид., мин</th>
                  <th className="num">Доработки</th><th className="num">Цикл, мин</th><th className="num">Fitness</th><th className="num">Вехи</th>
                  <th className="num">Решение</th><th className="num">ПБ вход→выход</th><th className="num">TLX</th>
                </tr></thead>
                <tbody>
                  {data.sessions.map((r) => (
                    <tr key={`${r.team_id}/${r.session_id}`}>
                      <td><Link to={`/admin/s/${r.team_id}/${r.session_id}`} className="mono small">{r.team_id}/{r.session_id}</Link>
                        <div className="tiny muted">{r.label}</div></td>
                      <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: condColor(r.condition) }} />{conditionTitle(r.condition)}</span></td>
                      <td className="num">{r.participants}</td>
                      <td className="num">{r.cases ?? 0}</td>
                      <td className="num">{r.waiting_hours_mean === null || r.waiting_hours_mean === undefined ? "—" : num(Number(r.waiting_hours_mean) * 60)}</td>
                      <td className="num">{pct(r.rework_case_share as number | null)}</td>
                      <td className="num">{r.cycle_hours_mean === null || r.cycle_hours_mean === undefined ? "—" : num(Number(r.cycle_hours_mean) * 60)}</td>
                      <td className="num">{pct(r.fitness_mean as number | null)}</td>
                      <td className="num">{pct(r.on_time_final as number | null)}</td>
                      <td className="num">{r.decision_correct === null || r.decision_correct === undefined ? "—" : r.decision_correct ? "✓" : "✗"}</td>
                      <td className="num">{num(r.psych_safety_entry as number | null, 2)} → {num(r.psych_safety_exit as number | null, 2)}</td>
                      <td className="num">{num(r.workload_tlx as number | null, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}><h3>Выгрузки</h3><span className="hint">только псевдонимы, без имён</span></div>
          <div className="grid-3" style={{ gap: 10 }}>
            {EXPORTS.map((x) => (
              <button key={x.name} className="pick" style={{ padding: 14, alignItems: "flex-start", justifyContent: "space-between" }} disabled={busy}
                onClick={() => run(() => download(`/api/admin/export/${x.name}`, token, `tessera-${x.name}`))}>
                <span className="stack" style={{ gap: 2, textAlign: "left" }}>
                  <strong>{x.title}</strong><span className="small muted" style={{ fontWeight: 400 }}>{x.desc}</span>
                  <span className="mono tiny muted">{x.name}</span>
                </span>
                <Icon name="download" />
              </button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}><h3>Таблица соответствия имён</h3><Icon name="lock" /></div>
          <p className="soft">
            Имена, которые участники указали для команды, хранятся отдельно от данных исследования (схема <span className="kbd">identity</span>).
            После завершения сбора их нужно удалить — псевдонимы и все данные останутся.
          </p>
          <div className="row between wrap">
            <span className="small">Сейчас хранится имён: <strong>{identity.data?.names ?? "—"}</strong></span>
            <button className="btn danger" disabled={!identity.data?.names} onClick={() => setPurge(true)}><Icon name="trash" />Удалить все имена</button>
          </div>
        </section>
      </div>

      {purge && (
        <Modal onClose={() => setPurge(false)}>
          <div className="stack lg">
            <h3>Удалить таблицу соответствия?</h3>
            <p className="soft">Все имена участников будут удалены безвозвратно. Экраны команд покажут только роли.
              Делайте это после завершения сбора данных.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setPurge(false)}>Отмена</button>
              <button className="btn danger" onClick={() => { setPurge(false); run(async () => { await api("/api/admin/identity/purge", { method: "POST", token }); identity.reload(); }, "Имена удалены"); }}>
                Удалить навсегда</button>
            </div>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}
