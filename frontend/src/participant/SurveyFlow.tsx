import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { capitalize, shortName } from "../lib/people";
import type { Instrument, SurveyStatus } from "../lib/types";
import { PersonTile } from "../ui/core";
import { usePlay } from "./context";

type Step =
  | { kind: "intro" }
  | { kind: "likert" | "slider"; inst: Instrument; item: Instrument["items"][number] }
  | { kind: "text"; inst: Instrument; item: Instrument["items"][number] }
  | { kind: "nominate"; question: string; text: string }
  | { kind: "mirror_stress" }
  | { kind: "mirror_loaded" }
  | { kind: "strengths" }
  | { kind: "agreements" }
  | { kind: "submit" };

const INTRO: Record<string, { title: string; text: string }> = {
  entry: { title: "Входной замер", text: "Несколько вопросов о команде до начала работы. Правильных ответов нет — отвечайте, как чувствуете." },
  pulse: { title: "Пульс-опрос", text: "Минута о прошедшей сессии: нагрузка, уверенность, коллеги. В конце — «Зеркало»: угадайте, как ответила команда." },
  exit: { title: "Выходной замер", text: "Последние вопросы: как изменилась команда, что вы поняли, и что вы цените в коллегах." },
};

export function SurveyPhase() {
  const { state } = usePlay();
  const spec = state.survey;
  if (!spec) return <WaitingTeam title="Ждём, пока ведущий откроет опрос" />;
  if (spec.done) return <WaitingTeam title="Спасибо, ответы сохранены" done />;
  return <SurveyFlow spec={spec} />;
}

function WaitingTeam({ title, done }: { title: string; done?: boolean }) {
  const { state } = usePlay();
  const phase = state.session.phase;
  const ready = state.roster.filter((p) => (state.progress[p.participant_id] ?? []).some((x) => x.startsWith(`${phase}:`)));
  return (
    <main className="page narrow stack xl" style={{ paddingTop: 60, textAlign: "center", alignItems: "center" }}>
      {done && (
        <motion.div initial={{ scale: 0.4, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }}>
          <span className="tile xl" style={{ ["--c" as string]: "var(--good)" }}><Check size={34} /></span>
        </motion.div>
      )}
      <h2>{title}</h2>
      <p className="soft">Ответили {ready.length} из {state.roster.length}. Ведущий переключит этап, когда все будут готовы.</p>
      <div className="row wrap" style={{ justifyContent: "center", gap: 12 }}>
        {state.roster.map((p) => {
          const ok = ready.includes(p);
          return (
            <div key={p.participant_id} className="stack xs" style={{ alignItems: "center", width: 76, opacity: ok ? 1 : 0.4 }}>
              <PersonTile person={p} size="lg" badge={ok ? "✓" : undefined} />
              <span className="tiny ellipsis" style={{ maxWidth: 76 }}>{shortName(p)}</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function SurveyFlow({ spec }: { spec: SurveyStatus }) {
  const { state, me, act, busy } = usePlay();
  const teammates = state.roster.filter((p) => p.participant_id !== me.participant_id);
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ kind: "intro" }];
    for (const inst of spec.instruments) {
      for (const item of inst.items) {
        out.push(inst.type === "text" ? { kind: "text", inst, item } : { kind: inst.type, inst, item });
      }
    }
    if (spec.nominations && teammates.length) {
      Object.entries(spec.nominations).forEach(([question, text]) => out.push({ kind: "nominate", question, text }));
    }
    if (spec.mirror && teammates.length) {
      out.push({ kind: "mirror_stress" }, { kind: "mirror_loaded" });
    }
    if (spec.strengths && teammates.length) out.push({ kind: "strengths" });
    if (spec.agreements?.length) out.push({ kind: "agreements" });
    out.push({ kind: "submit" });
    return out;
  }, [spec, teammates.length]);

  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [answers, setAnswers] = useState<Record<string, Record<string, number>>>({});
  const [texts, setTexts] = useState<Record<string, Record<string, string>>>({});
  const [noms, setNoms] = useState<Record<string, string[]>>({});
  const [stress, setStress] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [strengths, setStrengths] = useState<Record<string, string>>({});
  const [agreements, setAgreements] = useState<Record<string, number>>({});
  const step = steps[i];

  const valueOf = (s: Step) => (s.kind === "likert" || s.kind === "slider") ? answers[s.inst.id]?.[s.item.id] : undefined;
  const answered = (s: Step): boolean => {
    if (s.kind === "likert" || s.kind === "slider") return valueOf(s) !== undefined;
    if (s.kind === "text") return !!texts[s.inst.id]?.[s.item.id]?.trim() || !!s.item.optional;
    if (s.kind === "mirror_stress") return stress !== null;
    return true;
  };
  const go = useCallback((delta: number) => {
    setDir(delta);
    setI((x) => Math.min(steps.length - 1, Math.max(0, x + delta)));
  }, [steps.length]);

  const setValue = (s: Step, v: number, advance = true) => {
    if (s.kind !== "likert" && s.kind !== "slider") return;
    setAnswers((a) => ({ ...a, [s.inst.id]: { ...a[s.inst.id], [s.item.id]: v } }));
    if (advance) window.setTimeout(() => go(1), 260);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (step.kind === "likert") {
        const n = Number(e.key);
        if (n >= step.inst.min && n <= step.inst.max) setValue(step, n);
      }
      if (e.key === "Enter" && answered(step) && step.kind !== "submit") go(1);
      if (e.key === "ArrowLeft" || e.key === "Backspace") go(-1);
      if (e.key === "ArrowRight" && answered(step) && step.kind !== "submit") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const submit = () => act("/api/p/survey", {
    answers, texts, nominations: noms, strengths, agreements,
    mirror: spec.mirror ? { team_stress: stress, most_loaded: loaded } : {},
  }, "Ответы сохранены");

  const missing = steps.filter((s) => !answered(s));
  const intro = INTRO[spec.phase];
  const progress = i / (steps.length - 1);

  return (
    <div className="flow">
      <div className="flow-top">
        <button className="btn ghost icon sm" onClick={() => go(-1)} disabled={i === 0} aria-label="Назад"><ArrowLeft size={16} /></button>
        <div className="bar accent grow"><span style={{ width: `${progress * 100}%` }} /></div>
        <span className="tiny muted mono nowrap">{Math.max(0, i)} / {steps.length - 1}</span>
      </div>
      <AnimatePresence mode="wait" custom={dir}>
        <motion.div key={i} className="flow-q" custom={dir}
          initial={{ opacity: 0, x: dir * 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -40 }}
          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}>

          {step.kind === "intro" && (
            <>
              <span className="eyebrow">{intro?.title}</span>
              <div className="q-text" style={{ fontSize: "clamp(28px,4vw,44px)" }}>Пара минут о команде</div>
              <p className="soft" style={{ fontSize: 17, maxWidth: 560 }}>{intro?.text}</p>
              <div><button className="btn primary lg" onClick={() => go(1)}>Начать <ArrowRight size={18} /></button></div>
              <span className="tiny muted">Можно отвечать клавишами 1–7 и Enter.</span>
            </>
          )}

          {(step.kind === "likert" || step.kind === "slider" || step.kind === "text") && (
            <>
              <span className="eyebrow">{step.inst.title}</span>
              <div className="q-text">{step.item.text}{step.kind === "text" && step.item.optional && <span className="muted" style={{ fontSize: 16 }}> · необязательно</span>}</div>
            </>
          )}
          {step.kind === "likert" && (
            <div className="stack sm">
              <div className="scale" style={{ ["--n" as string]: step.inst.max - step.inst.min + 1 }} role="radiogroup">
                {Array.from({ length: step.inst.max - step.inst.min + 1 }, (_, k) => step.inst.min + k).map((v) => (
                  <button key={v} role="radio" aria-checked={valueOf(step) === v} aria-pressed={valueOf(step) === v} onClick={() => setValue(step, v)}>{v}</button>
                ))}
              </div>
              {step.inst.labels && <div className="scale-ends"><span>{step.inst.labels[0]}</span><span>{step.inst.labels[1]}</span></div>}
            </div>
          )}
          {step.kind === "slider" && (
            <SliderQ value={valueOf(step)} min={step.inst.min} max={step.inst.max} stepSize={step.inst.step ?? 1} labels={step.inst.labels}
              onChange={(v) => setValue(step, v, false)} />
          )}
          {step.kind === "text" && (
            <textarea className="textarea" style={{ minHeight: 140, fontSize: 16 }} autoFocus value={texts[step.inst.id]?.[step.item.id] ?? ""}
              onChange={(e) => setTexts((t) => ({ ...t, [step.inst.id]: { ...t[step.inst.id], [step.item.id]: e.target.value } }))} />
          )}

          {step.kind === "nominate" && (
            <>
              <span className="eyebrow">Коллеги · можно выбрать несколько или никого</span>
              <div className="q-text">{step.text}</div>
              <div className="pick-grid">
                {teammates.map((p) => {
                  const on = noms[step.question]?.includes(p.participant_id) ?? false;
                  return (
                    <button key={p.participant_id} className="pick" aria-pressed={on}
                      onClick={() => setNoms((n) => ({ ...n, [step.question]: on ? (n[step.question] ?? []).filter((x) => x !== p.participant_id) : [...(n[step.question] ?? []), p.participant_id] }))}>
                      <PersonTile person={p} size="sm" />
                      <span className="stack" style={{ gap: 0 }}><span>{shortName(p)}</span><span className="sub">{capitalize(p.role_title)}</span></span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step.kind === "mirror_stress" && spec.mirror && (
            <>
              <span className="eyebrow">Зеркало · {spec.mirror.intro}</span>
              <div className="q-text">{spec.mirror.team_stress.text}</div>
              <SliderQ value={stress ?? undefined} min={0} max={100} stepSize={5} labels={spec.mirror.team_stress.labels} onChange={setStress} />
            </>
          )}
          {step.kind === "mirror_loaded" && spec.mirror && (
            <>
              <span className="eyebrow">Зеркало</span>
              <div className="q-text">{spec.mirror.most_loaded.text}</div>
              <div className="pick-grid">
                {state.roster.map((p) => (
                  <button key={p.participant_id} className="pick" aria-pressed={loaded === p.participant_id} onClick={() => setLoaded(p.participant_id)}>
                    <PersonTile person={p} size="sm" /><span>{shortName(p)}{p.participant_id === me.participant_id ? " (я)" : ""}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step.kind === "strengths" && (
            <>
              <span className="eyebrow">Сильные стороны · коллеги увидят итог анонимно</span>
              <div className="q-text">Что вы цените в каждом из коллег?</div>
              <div className="stack">
                {teammates.map((p) => (
                  <div key={p.participant_id} className="stack sm">
                    <div className="row"><PersonTile person={p} size="sm" /><strong>{shortName(p)}</strong><span className="muted small">{p.role_title}</span></div>
                    <div className="row wrap tight">
                      {state.scenario.strengths.map((s) => (
                        <button key={s.id} className={`btn xs ${strengths[p.participant_id] === s.id ? "primary" : ""}`}
                          onClick={() => setStrengths((x) => ({ ...x, [p.participant_id]: s.id }))}>{s.title}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step.kind === "agreements" && (
            <>
              <span className="eyebrow">Договорённости прошлой сессии</span>
              <div className="q-text">Насколько команда соблюдала то, о чём договорилась?</div>
              <div className="stack lg">
                {spec.agreements.map((a) => (
                  <div key={a.agreement_id} className="stack sm">
                    <strong>{a.body}</strong>
                    <div className="scale" style={{ ["--n" as string]: 5 }}>
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button key={v} aria-pressed={agreements[a.agreement_id] === v} onClick={() => setAgreements((x) => ({ ...x, [a.agreement_id]: v }))}>{v}</button>
                      ))}
                    </div>
                    <div className="scale-ends"><span>Совсем нет</span><span>Полностью</span></div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step.kind === "submit" && (
            <>
              <span className="eyebrow">Готово</span>
              <div className="q-text">{missing.length ? `Осталось ответить на ${missing.length}` : "Все ответы на месте"}</div>
              {missing.length > 0 ? (
                <div className="row wrap tight">
                  {missing.map((s) => (
                    <button key={steps.indexOf(s)} className="btn sm" onClick={() => { setDir(-1); setI(steps.indexOf(s)); }}>
                      Вопрос {steps.indexOf(s)}
                    </button>
                  ))}
                </div>
              ) : (
                <div><button className="btn accent xl" disabled={busy} onClick={submit}>Отправить ответы <Check size={18} /></button></div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {step.kind !== "intro" && step.kind !== "submit" && (
        <div className="row between">
          <span className="tiny muted">{step.kind === "likert" ? "Выберите вариант — перейдём дальше сами" : ""}</span>
          <button className="btn primary" disabled={!answered(step)} onClick={() => go(1)}>Дальше <ArrowRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

function SliderQ({ value, min, max, stepSize, labels, onChange }: {
  value: number | undefined; min: number; max: number; stepSize: number; labels?: [string, string]; onChange: (v: number) => void;
}) {
  const v = value ?? Math.round((min + max) / 2 / stepSize) * stepSize;
  return (
    <div className="slider-big">
      <div className="value" style={{ opacity: value === undefined ? 0.35 : 1 }}>{value ?? "—"}</div>
      <input type="range" className="range" min={min} max={max} step={stepSize} value={v}
        style={{ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))} onPointerDown={() => value === undefined && onChange(v)} aria-label="Значение" />
      {labels && <div className="scale-ends"><span>{labels[0]}</span><span>{labels[1]}</span></div>}
    </div>
  );
}
