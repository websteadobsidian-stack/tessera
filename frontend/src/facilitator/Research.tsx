import { useState } from "react";
import { Link } from "react-router-dom";
import { Database, FlaskConical } from "lucide-react";
import { ConditionDots, Scatter, type Metric } from "../charts/Research";
import { api } from "../lib/api";
import { CONDITIONS, condColor, conditionTitle, num, pct } from "../lib/format";
import { useLive } from "../lib/live";
import { Empty, Loader, Switch } from "../ui/core";
import { Reveal } from "../ui/effects";
import { PageHead, useFacilitator } from "./Shell";

type Row = Record<string, unknown> & { condition: string; team_id: string; session_id: string; label?: string; is_demo?: boolean; protocol_title?: string | null };

interface ResearchData {
  sessions: Row[];
  conditions: Record<string, Record<string, number | null>>;
  protocols: Record<string, Record<string, number | null>>;
  hypotheses: {
    h2: { points: { team_id: string; session_id: string; condition: string; x: number; y: number; decision_correct: number | null }[]; r: number | null; n: number };
    h3: { points: { team_id: string; session_id: string; milestone: string; condition: string; x: number; late: boolean }[]; r: number | null; n: number };
    h4: { points: { team_id: string; participant_id: string; condition: string; pm: boolean; x: number; y: number }[]; r: number | null; n: number; r_pm: number | null };
  };
  include_demo: boolean;
  demo_available: number;
}

const f1 = (v: number) => num(v, 1);
const fp = (v: number) => pct(v);
const METRICS: Metric[] = [
  { key: "waiting_minutes", title: "Ожидание задачи", hint: "среднее, логические минуты", format: (v) => `${num(v, 1)} мин`, better: "lower" },
  { key: "rework_case_share", title: "Доля доработок", hint: "задачи, возвращавшиеся назад", format: fp, better: "lower" },
  { key: "on_time_final", title: "Вехи в срок", hint: "по итоговым срокам", format: fp, better: "higher" },
  { key: "decision_correct", title: "Верное решение", hint: "скрытый профиль: выбран лучший вариант", format: fp, better: "higher" },
  { key: "info_pooled", title: "Факты до решения", hint: "доля ключевых фактов на столе к моменту решения", format: fp, better: "higher" },
  { key: "probe_alignment", title: "Синхрон", hint: "совпадение ответов команды", format: fp, better: "higher" },
  { key: "help_latency", title: "Отклик на помощь", hint: "медиана, логические минуты", format: (v) => `${num(v, 1)} мин`, better: "lower" },
  { key: "kudos_per_person", title: "Спасибо на человека", hint: "за сессию", format: f1, better: "higher" },
  { key: "gini", title: "Неравенство участия", hint: "Джини по действиям", format: (v) => num(v, 2), better: "lower" },
  { key: "synergy", title: "Сыгранность", hint: "индекс 0–100", format: (v) => num(v, 0), better: "higher" },
  { key: "psych_safety_delta", title: "Δ психологической безопасности", hint: "выход − вход, шкала PS7", format: (v) => `${v > 0 ? "+" : ""}${num(v, 2)}`, better: "higher" },
  { key: "workload_tlx", title: "Нагрузка NASA-TLX", hint: "пульс-опрос, 0–100", format: (v) => num(v, 0), better: "lower" },
];

export function Research() {
  const { token } = useFacilitator();
  const [demo, setDemo] = useState(false);
  const { data } = useLive<ResearchData>(token, (signal) => api(`/api/admin/research?include_demo=${demo}`, { token, signal }),
    { deps: [demo], fallbackMs: 60000, debounceMs: 3000 });
  const rows = (data?.sessions ?? []).filter((r) => (r.cases as number) > 0);

  return (
    <main className="page wide stack xl">
      <PageHead eyebrow="Исследование" title="Сравнение команд и методик"
        lead="Точки — команды, черта — среднее по условию. На малых выборках смотрите на направление и разброс, а не на «значимость».">
        <label className="row tight small soft" style={{ cursor: "pointer" }}>
          <Switch checked={demo} onChange={setDemo} label="Включить демо-данные" />Демо-данные{data?.demo_available ? ` (${data.demo_available})` : ""}
        </label>
      </PageHead>
      {demo && <div className="notice nudge"><span className="ico"><FlaskConical size={15} /></span><div><div className="title">В выборке демо-команды</div><div className="body">Их данные сгенерированы. Для отчётов выключите переключатель — демо в выгрузки и анализ по умолчанию не попадает.</div></div></div>}
      {!data ? <Loader label="Считаем…" /> : rows.length === 0 ? (
        <div className="panel">
          <Empty title="Пока нечего сравнивать">
            Здесь появятся команды, прошедшие рабочую сессию. Хотите посмотреть, как это выглядит, — засейте демо-историю.
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              {data.demo_available > 0 && !demo ? <button className="btn primary" onClick={() => setDemo(true)}>Показать демо-данные</button>
                : <Link className="btn primary" to="/facilitator/data"><Database size={16} />Засеять демо-историю</Link>}
            </div>
          </Empty>
        </div>
      ) : (
        <>
          <div className="stats four">
            {CONDITIONS.map((c) => (
              <div key={c.key} className="stat" style={{ borderColor: `color-mix(in srgb, ${condColor(c.key)} 40%, var(--stroke))` }}>
                <div className="k row tight"><span className="swatch" style={{ background: condColor(c.key) }} />{c.title}</div>
                <div className="v">{rows.filter((r) => r.condition === c.key).length}<small>сессий</small></div>
                <div className="d">сыгранность {num(data.conditions[c.key]?.synergy ?? null, 0)} · верное решение {pct(data.conditions[c.key]?.decision_correct ?? null)}</div>
              </div>
            ))}
          </div>

          <section className="stack lg">
            <h2>Методики</h2>
            <div className="dots-grid">
              {METRICS.map((m, i) => <Reveal key={m.key} delay={(i % 4) * 0.04}><ConditionDots rows={rows} metric={m} /></Reveal>)}
            </div>
          </section>

          <section className="stack lg">
            <h2>Гипотезы концепции</h2>
            <div className="grid-2">
              <div className="panel stack">
                <span className="eyebrow">H2</span>
                <h3>Психологическая безопасность и доработки</h3>
                <p className="small soft">Команды с большей безопасностью (PS7 на выходе) реже возвращают задачи? Кольцо — команда нашла верное решение.</p>
                <Scatter points={data.hypotheses.h2.points.map((p) => ({ x: p.x, y: p.y, condition: p.condition, label: `${p.team_id}/${p.session_id}`, ring: p.decision_correct === 1 }))}
                  xLabel="PS7 на выходе" yLabel="доля доработок" xFormat={(v) => num(v, 1)} yFormat={fp} r={data.hypotheses.h2.r} n={data.hypotheses.h2.n} />
              </div>
              <div className="panel stack">
                <span className="eyebrow">H3</span>
                <h3>Межотдельные передачи и срыв вех</h3>
                <p className="small soft">Больше передач между отделами на задачах вехи — выше риск опоздать? Ось Y: 1 — веха закрыта позже срока.</p>
                <Scatter points={data.hypotheses.h3.points.map((p) => ({ x: p.x, y: p.late ? 1 : 0, condition: p.condition, label: `${p.team_id}/${p.session_id} · ${p.milestone}` }))}
                  xLabel="межотдельных передач на задачу" yLabel="опоздание" xFormat={(v) => num(v, 1)} yFormat={(v) => (v > 0.99 ? "да" : v < 0.01 ? "нет" : "")} r={data.hypotheses.h3.r} n={data.hypotheses.h3.n} />
              </div>
              <div className="panel stack">
                <span className="eyebrow">H4</span>
                <h3>Неформальное лидерство</h3>
                <p className="small soft">Совпадает ли центральность в сети передач с тем, кого коллеги называют фактическим лидером? Кольцо — формальный руководитель.</p>
                <Scatter points={data.hypotheses.h4.points.map((p) => ({ x: p.x, y: p.y, condition: p.condition, label: `${p.participant_id} · ${conditionTitle(p.condition)}`, ring: p.pm }))}
                  xLabel="нагрузка в сети передач" yLabel="доля голосов «лидер»" xFormat={fp} yFormat={fp} r={data.hypotheses.h4.r} n={data.hypotheses.h4.n}
                  highlight={data.hypotheses.h4.r_pm !== null ? `r (формальная роль) = ${num(data.hypotheses.h4.r_pm, 2)}` : undefined} />
              </div>
              <div className="panel stack">
                <span className="eyebrow">H1</span>
                <h3>Методика и поток</h3>
                <p className="small soft">Сравнение ожидания и доработок по условиям — первые две панели раздела «Методики». Вариативность внутри условия часто больше, чем между ними: это нормально для команд.</p>
                <div className="stack sm">
                  {CONDITIONS.map((c) => {
                    const g = data.conditions[c.key];
                    return (
                      <div key={c.key} className="row small" style={{ gap: 10 }}>
                        <span className="swatch" style={{ background: condColor(c.key) }} />
                        <span style={{ width: 130 }}>{c.title}</span>
                        <span className="soft grow">ожидание {num(g?.waiting_minutes ?? null, 1)} мин · доработки {pct(g?.rework_case_share ?? null)}</span>
                        <span className="tiny muted">n={g?.teams ?? 0}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {Object.keys(data.protocols).length > 1 && (
            <section className="stack lg">
              <h2>Протоколы</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Протокол</th><th className="num">Сессий</th><th className="num">Сыгранность</th><th className="num">Верное решение</th><th className="num">Факты до решения</th><th className="num">Ожидание</th><th className="num">Спасибо/чел.</th></tr></thead>
                  <tbody>{Object.entries(data.protocols).map(([p, g]) => (
                    <tr key={p}><td>{p}</td><td className="num">{g.teams}</td><td className="num">{num(g.synergy, 0)}</td><td className="num">{pct(g.decision_correct)}</td>
                      <td className="num">{pct(g.info_pooled)}</td><td className="num">{num(g.waiting_minutes, 1)} мин</td><td className="num">{num(g.kudos_per_person, 1)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}

          <section className="stack lg">
            <h2>Сессии</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Команда</th><th>Методика</th><th>Протокол</th><th className="num">Задач</th><th className="num">Ожидание</th><th className="num">Доработки</th><th className="num">Решение</th><th className="num">Сыгранность</th><th className="num">Δ PS7</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={`${r.team_id}${r.session_id}`}>
                    <td><Link to={`/facilitator/session/${r.team_id}/${r.session_id}`} className="mono small">{r.team_id}/{r.session_id}</Link>{r.is_demo && <span className="chip" style={{ marginLeft: 6 }}>демо</span>}
                      {r.label && <div className="tiny muted ellipsis" style={{ maxWidth: 220 }}>{r.label as string}</div>}</td>
                    <td><span className="row tight"><span className="swatch" style={{ background: condColor(r.condition) }} />{conditionTitle(r.condition)}</span></td>
                    <td className="small soft">{r.protocol_title ?? "—"}</td>
                    <td className="num">{String(r.completed ?? 0)}/{String(r.cases)}</td>
                    <td className="num">{num(r.waiting_minutes as number | null, 1)}</td>
                    <td className="num">{pct(r.rework_case_share as number | null)}</td>
                    <td className="num">{r.decision_correct === null || r.decision_correct === undefined ? "—" : r.decision_correct ? "✓" : "✗"}</td>
                    <td className="num">{num(r.synergy as number | null, 0)}</td>
                    <td className="num">{num(r.psych_safety_delta as number | null, 2)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
