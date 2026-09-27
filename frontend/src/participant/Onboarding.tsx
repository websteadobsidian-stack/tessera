import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { TOKENS, api, store } from "../lib/api";
import { personColor } from "../lib/people";
import type { ParticipantState, Role } from "../lib/types";
import { useAction } from "../ui/overlays";

const ROLE_HINT: Record<string, string> = {
  pm: "Держит сроки и вехи, говорит с клиентом",
  analyst: "Разбирает требования, формулирует задачи",
  finance: "Считает деньги и стоимость решений",
  engineer: "Делает работу и знает реальные трудозатраты",
  qa: "Принимает результат, отвечает за качество",
};

export function Onboarding({ state, token, reload }: { state: ParticipantState; token: string; reload: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const { run, busy } = useAction();

  const decide = (agree: boolean) => run(async () => {
    await api("/api/p/consent", { method: "POST", token, body: { agree, role_slug: role?.slug ?? null, display_name: name.trim() || null } });
    if (!agree) store.del(TOKENS.participant);
    await reload();
  });

  const slot = role ? (role.colors?.[Math.min(role.taken ?? 0, (role.colors?.length ?? 1) - 1)] ?? 1) : 1;

  return (
    <main className="onboard">
      <div className="onboard-card stack xl">
        <div className="steps-line" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.section key="consent" className="stack xl" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="stack">
                <span className="eyebrow">Команда {state.team.label || state.team.team_id}</span>
                <h1>Добро пожаловать в&nbsp;«{state.company.title}»</h1>
                <p className="soft" style={{ fontSize: 17, maxWidth: 620 }}>{state.company.description}</p>
              </div>
              <div className="panel stack lg">
                <div className="row"><ShieldCheck size={22} color="var(--accent)" /><h3>Согласие на участие</h3></div>
                <ul className="consent-list">
                  {state.consent_text?.map((t, i) => <li key={i}><ArrowRight size={16} />{t}</li>)}
                </ul>
              </div>
              <div className="row between wrap">
                <button className="btn ghost" disabled={busy} onClick={() => decide(false)}>Не участвовать</button>
                <button className="btn primary lg" onClick={() => setStep(1)}>Согласен(на) <ArrowRight size={18} /></button>
              </div>
            </motion.section>
          )}

          {step === 1 && (
            <motion.section key="role" className="stack xl" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="stack">
                <span className="eyebrow">Шаг 2 из 3</span>
                <h2>Кем вы будете в «{state.company.title}»?</h2>
                <p className="soft">Договоритесь за столом, кто какую роль берёт. У каждой роли свои секретные факты.</p>
              </div>
              <div className="role-grid">
                {(state.roles ?? []).map((r) => {
                  const full = (r.taken ?? 0) >= r.capacity;
                  const c = personColor(r.colors?.[Math.min(r.taken ?? 0, (r.colors?.length ?? 1) - 1)] ?? 1);
                  return (
                    <button key={r.slug} className="role-card" aria-pressed={role?.slug === r.slug} disabled={full}
                      style={{ ["--c" as string]: c }} onClick={() => setRole(r)}>
                      <div className="row between">
                        <span className="tile lg" style={{ ["--c" as string]: c }}>{r.title.slice(0, 2).toUpperCase()}</span>
                        <span className="chip">{full ? "занято" : r.capacity > 1 ? `${r.taken ?? 0} / ${r.capacity}` : "свободно"}</span>
                      </div>
                      <span className="role-title">{r.title}</span>
                      <span className="small soft">{ROLE_HINT[r.slug] ?? r.summary}</span>
                      <span className="tiny muted">{r.department}{r.home_stages?.length ? ` · этап «${r.home_stages[0]}»` : ""}</span>
                    </button>
                  );
                })}
              </div>
              <div className="row between">
                <button className="btn ghost" onClick={() => setStep(0)}><ArrowLeft size={16} /> Назад</button>
                <button className="btn primary lg" disabled={!role} onClick={() => setStep(2)}>Дальше <ArrowRight size={18} /></button>
              </div>
            </motion.section>
          )}

          {step === 2 && role && (
            <motion.section key="name" className="stack xl" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="row" style={{ gap: 28, alignItems: "center", flexWrap: "wrap" }}>
                <motion.span className="tile xxl" style={{ ["--c" as string]: personColor(slot) }}
                  initial={{ rotateY: 180, scale: 0.6, opacity: 0 }} animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 160, damping: 14 }}>
                  {(name.trim() || role.title).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </motion.span>
                <div className="stack grow" style={{ minWidth: 240 }}>
                  <span className="eyebrow">Шаг 3 из 3 · ваш фрагмент</span>
                  <h2>Это ваш цвет в мозаике команды</h2>
                  <p className="soft">Каждое ваше действие станет плиткой этого цвета в портрете команды. Плитки, где вы работали с кем-то, будут двухцветными.</p>
                </div>
              </div>
              <div className="field">
                <label htmlFor="name">Как вас называть в команде <span className="muted">(необязательно)</span></label>
                <input id="name" className="input" style={{ height: 52, fontSize: 17 }} maxLength={40} value={name} autoFocus
                  onChange={(e) => setName(e.target.value)} placeholder="Например, Аня" onKeyDown={(e) => e.key === "Enter" && decide(true)} />
                <span className="tiny muted">Имя видят только коллеги по команде. В данные исследования оно не попадает и удаляется после сбора.</span>
              </div>
              <div className="row between">
                <button className="btn ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Назад</button>
                <button className="btn accent lg" disabled={busy} onClick={() => decide(true)}>Войти в команду <ArrowRight size={18} /></button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
