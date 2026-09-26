import { HBars } from "../charts/Bars";
import { FlowChart } from "../charts/FlowChart";
import { Network } from "../charts/Network";
import { ProcessMap } from "../charts/ProcessMap";
import { STAGES, conditionTitle, minutes, num, pct, stageColor } from "../format";
import type { Debrief as D } from "../types";
import { Icon } from "./ui";

function Stat({ k, v, unit, d }: { k: string; v: string; unit?: string; d?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}{unit && v !== "—" && <small>{unit}</small>}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}

export function Debrief({ data }: { data: D }) {
  const s = data.summary;
  const total = data.tasks.length;
  const ps = data.surveys;
  const psIn = ps.entry?.psych_safety_7?.mean;
  const psOut = ps.exit?.psych_safety_7?.mean;
  const decision = data.decision;
  const waitingRows = STAGES.filter((st) => data.waiting_by_stage[st] !== undefined)
    .map((st) => ({ label: st, value: data.waiting_by_stage[st] }));
  const maxLoad = Math.max(1e-9, ...data.people.map((p) => p.load));

  if (!data.events) {
    return (
      <div className="card"><div className="empty"><div className="big">Пока нечего разбирать</div>
        Карта процесса появится, когда команда начнёт двигать задачи.</div></div>
    );
  }

  return (
    <div className="stack lg">
      <div className="stats four">
        <Stat k="Сдано задач" v={`${s?.completed ?? 0}`} unit={`из ${total}`} d={`${s?.cases ?? 0} начато`} />
        <Stat k="Время цикла" v={num(minutes(s?.cycle_hours_mean))} unit="мин" d="от анализа до сдачи, среднее" />
        <Stat k="Ожидание" v={num(minutes(s?.waiting_hours_mean))} unit="мин" d={s?.bottleneck_stage ? <>дольше всего — «{s.bottleneck_stage}»</> : "до начала работы на этапах"} />
        <Stat k="Доработки" v={pct(s?.rework_case_share)} d="задач возвращались хотя бы раз" />
        <Stat k="Соответствие эталону" v={pct(s?.fitness_mean)} d="доля разрешённых переходов" />
        <Stat k="Вехи в срок" v={s?.on_time_final === null || s?.on_time_final === undefined ? "—" : pct(s.on_time_final)}
          d={`закрыто ${s?.milestones_closed ?? 0} из ${data.milestones.length}`} />
        <Stat k="Ключевое решение" v={decision.chosen ?? "—"}
          d={decision.is_correct === null ? "ещё не принято"
            : decision.is_correct ? <span className="chip good"><Icon name="check" size={12} />лучший вариант</span>
            : <span className="chip warn"><Icon name="alert" size={12} />лучший — {decision.correct}</span>} />
        <Stat k="Психологическая безопасность" v={num(psOut ?? psIn, 2)} unit="/ 7"
          d={psIn !== undefined && psOut !== undefined ? `на входе ${num(psIn, 2)} → на выходе ${num(psOut, 2)}` : psIn !== undefined ? "входной замер" : "нет ответов"} />
      </div>

      <section className="card">
        <div className="card-head"><h3>Карта процесса</h3><span className="hint">как задачи на самом деле проходили через этапы</span></div>
        <ProcessMap dfg={data.dfg} waiting={data.waiting_by_stage} />
      </section>

      <section className="card">
        <div className="card-head"><h3>Поток работы</h3><span className="hint">сколько задач было на каждом этапе по ходу сессии</span></div>
        <FlowChart flow={data.flow} injects={data.injects} />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3>Сеть команды</h3></div>
          <Network data={data} />
        </section>
        <div className="stack lg">
          <section className="card">
            <div className="card-head"><h3>Где ждали</h3><span className="hint">среднее ожидание до начала работы</span></div>
            <HBars rows={waitingRows} unit="мин" />
          </section>
          <section className="card">
            <div className="card-head"><h3>Кто что делал</h3></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Участник</th><th>Доля передач</th><th className="num">Взял</th><th className="num">Сдал</th><th className="num">Вернул</th></tr></thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.participant_id}>
                      <td><div style={{ fontWeight: 600 }}>{p.display_name || p.participant_id}</div><div className="tiny muted">{p.role}</div></td>
                      <td><div className="bar-cell"><div className="track"><div className="fill" style={{ width: `${(p.load / maxLoad) * 100}%` }} /></div><span className="tiny mono">{pct(p.load)}</span></div></td>
                      <td className="num">{p.started}</td><td className="num">{p.completed}</td><td className="num">{p.reworks_sent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h3>Задачи</h3><span className="hint">{conditionTitle(data.condition)} · {data.events} событий в журнале</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Задача</th><th>Путь</th><th className="num">Цикл, мин</th><th className="num">Ожидание, мин</th><th className="num">Доработки</th></tr></thead>
            <tbody>
              {data.tasks.map((t) => (
                <tr key={t.case_id}>
                  <td><span className="mono tiny muted">{t.key}</span> <span style={{ fontWeight: 560 }}>{t.title}</span>
                    {t.injected && <span className="chip warn" style={{ marginLeft: 6 }}><Icon name="bolt" size={11} />вброс</span>}</td>
                  <td>
                    {t.trace ? (
                      <div className="row" style={{ gap: 3, flexWrap: "wrap" }}>
                        {t.trace.split(" → ").map((st, i) => (
                          <span key={i} className="swatch" title={st} style={{ width: 16, height: 10, background: stageColor(st) }} />
                        ))}
                      </div>
                    ) : <span className="tiny muted">не начата</span>}
                  </td>
                  <td className="num">{num(t.cycle_minutes)}</td>
                  <td className="num">{num(t.waiting_minutes)}</td>
                  <td className="num">{t.reworks || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
