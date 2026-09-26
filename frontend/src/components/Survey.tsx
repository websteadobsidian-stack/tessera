import { useMemo, useState } from "react";
import { initials, personLabel } from "../format";
import type { Instrument, Person, SurveyStatus } from "../types";
import { Avatar, Icon } from "./ui";

type Answers = Record<string, Record<string, number>>;
type Texts = Record<string, Record<string, string>>;

const PHASE_INTRO: Record<string, { title: string; text: string }> = {
  entry: { title: "Входной замер", text: "Несколько вопросов о команде до начала работы. Правильных ответов нет." },
  pulse: { title: "Пульс-опрос", text: "Минута-две о прошедшей сессии. Оценки коллег анонимны: команда увидит только общую картину." },
  exit: { title: "Выходной замер", text: "Последние вопросы: как изменилась команда и что вы вынесли из интенсива." },
};

export function Survey({ spec, roster, me, onSubmit, busy }: {
  spec: SurveyStatus; roster: Person[]; me: string; busy?: boolean;
  onSubmit: (body: { answers: Answers; texts: Texts; nominations: Record<string, string[]> }) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [texts, setTexts] = useState<Texts>({});
  const [noms, setNoms] = useState<Record<string, string[]>>({});
  const [tried, setTried] = useState(false);
  const peers = roster.filter((p) => p.participant_id !== me);

  const required = useMemo(() => spec.instruments.flatMap((inst) =>
    inst.items.filter((i) => !i.optional).map((i) => ({ inst: inst.id, item: i.id, type: inst.type }))), [spec]);
  const answered = required.filter((r) => r.type === "text"
    ? !!texts[r.inst]?.[r.item]?.trim()
    : answers[r.inst]?.[r.item] !== undefined).length;
  const complete = answered === required.length;
  const intro = PHASE_INTRO[spec.phase];

  const set = (inst: string, item: string, v: number) => setAnswers((a) => ({ ...a, [inst]: { ...a[inst], [item]: v } }));

  return (
    <div className="stack lg">
      <div className="stack sm">
        <span className="section-title">{intro?.title}</span>
        <h1 style={{ fontSize: 30 }}>Пара минут о команде</h1>
        <p className="soft">{intro?.text}</p>
      </div>
      <div className="row" style={{ position: "sticky", top: 60, zIndex: 5, background: "var(--bg)", padding: "10px 0" }}>
        <div className="progress grow"><span style={{ width: `${(answered / Math.max(1, required.length)) * 100}%` }} /></div>
        <span className="small muted nowrap">{answered} из {required.length}</span>
      </div>

      {spec.instruments.map((inst) => (
        <section key={inst.id} className="card">
          <div className="card-head"><h3>{inst.title}</h3>{inst.source && <span className="hint tiny">{inst.source}</span>}</div>
          <div>
            {inst.items.map((item) => (
              <Question key={item.id} inst={inst} item={item} tried={tried}
                value={answers[inst.id]?.[item.id]} text={texts[inst.id]?.[item.id] ?? ""}
                onValue={(v) => set(inst.id, item.id, v)}
                onText={(v) => setTexts((t) => ({ ...t, [inst.id]: { ...t[inst.id], [item.id]: v } }))} />
            ))}
          </div>
        </section>
      ))}

      {spec.nominations && peers.length > 0 && (
        <section className="card">
          <div className="card-head"><h3>Коллеги</h3><span className="hint">можно выбрать несколько или никого</span></div>
          {Object.entries(spec.nominations).map(([q, text]) => (
            <div key={q} className="question">
              <div className="q">{text}</div>
              <div className="pick-grid">
                {peers.map((p) => {
                  const on = noms[q]?.includes(p.participant_id) ?? false;
                  return (
                    <button key={p.participant_id} className="pick" aria-pressed={on}
                      onClick={() => setNoms((n) => ({ ...n, [q]: on ? n[q].filter((x) => x !== p.participant_id) : [...(n[q] ?? []), p.participant_id] }))}>
                      <Avatar text={initials(p)} />{personLabel(p)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="row between wrap">
        <span className="small muted">{complete ? "Все ответы на месте." : "Ответьте на все обязательные вопросы."}</span>
        <button className="btn primary lg" disabled={busy}
          onClick={async () => { setTried(true); if (complete) await onSubmit({ answers, texts, nominations: noms }); }}>
          Отправить <Icon name="check" />
        </button>
      </div>
    </div>
  );
}

function Question({ inst, item, value, text, onValue, onText, tried }: {
  inst: Instrument; item: Instrument["items"][number]; value?: number; text: string; tried: boolean;
  onValue: (v: number) => void; onText: (v: string) => void;
}) {
  const missing = tried && !item.optional && (inst.type === "text" ? !text.trim() : value === undefined);
  return (
    <div className={`question ${missing ? "missing" : ""}`}>
      <div className="q">{item.text}{item.optional && <span className="muted small"> · необязательно</span>}</div>
      {inst.type === "likert" && (
        <>
          <div className="likert" style={{ ["--n" as string]: inst.max - inst.min + 1 }} role="radiogroup" aria-label={item.text}>
            {Array.from({ length: inst.max - inst.min + 1 }, (_, i) => inst.min + i).map((v) => (
              <button key={v} role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onValue(v)}>{v}</button>
            ))}
          </div>
          {inst.labels && <div className="scale-ends"><span>{inst.labels[0]}</span><span>{inst.labels[1]}</span></div>}
        </>
      )}
      {inst.type === "slider" && (
        <>
          <div className="row">
            <input type="range" min={inst.min} max={inst.max} step={inst.step ?? 1} value={value ?? (inst.min + inst.max) / 2}
              onChange={(e) => onValue(Number(e.target.value))} onClick={(e) => onValue(Number((e.target as HTMLInputElement).value))}
              style={{ opacity: value === undefined ? 0.45 : 1 }} aria-label={item.text} />
            <span className="mono small" style={{ width: 36, textAlign: "right" }}>{value ?? "—"}</span>
          </div>
          {inst.labels && <div className="scale-ends"><span>{inst.labels[0]}</span><span>{inst.labels[1]}</span></div>}
        </>
      )}
      {inst.type === "text" && <textarea className="textarea" value={text} onChange={(e) => onText(e.target.value)} />}
    </div>
  );
}
