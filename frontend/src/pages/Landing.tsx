import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Bot, Cloudy, FlaskConical, Gamepad2, HeartHandshake, LifeBuoy, LineChart, MessagesSquare, Radar, Scale, ScanEye,
  Shuffle, Sparkles, Telescope, Workflow,
} from "lucide-react";
import { ApiError, TOKENS, api, store } from "../lib/api";
import { CONDITIONS, condColor } from "../lib/format";
import { HeroCanvas } from "../mosaic/HeroCanvas";
import { HeroPreview } from "./HeroPreview";
import { Brand, ThemeToggle } from "../ui/core";
import { Reveal } from "../ui/effects";
import { Modal, useAction } from "../ui/overlays";
import { publicConfig } from "../ui/qr";

/** Вход по коду: если устройство уже в этой команде — продолжаем с тем же токеном. */
export async function joinTeam(code: string): Promise<void> {
  const clean = code.trim().toUpperCase();
  const existing = store.get(TOKENS.participant);
  if (existing) {
    try {
      const st = await api<{ team: { join_code: string }; session: { phase: string } }>("/api/p/state", { token: existing });
      if (st.team.join_code === clean && st.session.phase !== "closed") return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
    }
  }
  const r = await api<{ token: string }>("/api/join", { method: "POST", body: { code: clean } });
  store.set(TOKENS.participant, r.token);
}

const MECHANICS = [
  { icon: Scale, title: "Общий стол фактов", text: "У каждой роли свои секретные факты. Лучшее решение видно, только если сложить всё вместе." },
  { icon: MessagesSquare, title: "Эфир", text: "Командный канал с @упоминаниями и ссылками на задачи. В «тишине» — единственный." },
  { icon: LifeBuoy, title: "«Нужна помощь»", text: "Сигнал без стыда. Система видит, кто откликнулся и как быстро." },
  { icon: HeartHandshake, title: "«Спасибо»", text: "Признание за конкретное: помог, поделился, взял сложное. Строит сеть доверия." },
  { icon: Radar, title: "Синхрон", text: "Вопрос всем сразу на 45 секунд: видите ли вы одну и ту же картину?" },
  { icon: Cloudy, title: "Погода", text: "Каждый отмечает, как ему сейчас. Буря у коллеги — повод подойти." },
  { icon: Telescope, title: "Прогноз и Зеркало", text: "Предскажите результат, угадайте стресс команды — и сравните с реальностью." },
  { icon: Sparkles, title: "Портрет-мозаика", text: "Каждое действие — плитка вашего цвета. Работа вместе — двухцветные плитки." },
];

const LAB = [
  { icon: FlaskConical, title: "Протоколы", text: "Набор механик и таймлайн вмешательств — снимок условий для каждой команды." },
  { icon: Shuffle, title: "Рандомизация", text: "Серии команд с блочным распределением методик." },
  { icon: ScanEye, title: "Эксперименты", text: "Тишина, выезд ключевого человека, смена ролей, вбросы — вручную или по таймеру." },
  { icon: Workflow, title: "Process mining", text: "Журнал в CSV, XES и OCEL 2.0: карта процесса, ожидания, доработки." },
  { icon: LineChart, title: "Исследование", text: "Методики рядом: точки команд, гипотезы о безопасности, передачах и лидерстве." },
  { icon: Bot, title: "Демо и песочница", text: "Засейте историю или пройдите сессию одному — с командой ботов." },
];

export default function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { run, busy } = useAction();
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const hasSession = !!store.get(TOKENS.participant);
  useEffect(() => { void publicConfig().then((c) => setDemoEnabled(c.demo)); }, []);

  const value = code.join("");
  const submit = (v = value) => run(async () => { await joinTeam(v); navigate("/play"); });
  const setAt = (i: number, ch: string) => {
    const clean = ch.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split("");
      const filled = Array.from({ length: 6 }, (_, k) => next[k] ?? "");
      setCode(filled);
      inputs.current[Math.min(5, next.length)]?.focus();
      if (next.length >= 6) void submit(filled.join(""));
      return;
    }
    const next = [...code];
    next[i] = clean;
    setCode(next);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
    if (clean && i === 5 && next.every(Boolean)) void submit(next.join(""));
  };

  return (
    <div className="landing">
      <header className="topbar landing-top">
        <Brand />
        <div className="spacer" />
        <Link to="/facilitator" className="btn ghost sm">Для ведущего</Link>
        <ThemeToggle />
      </header>

      <section className="hero">
        <div className="hero-canvas"><HeroCanvas /></div>
        <div className="hero-fade" />
        <div className="hero-inner">
          <motion.div className="stack xl hero-copy" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="stack lg">
              <span className="eyebrow hero-eyebrow">Деловая игра · тренажёр команды · исследование</span>
              <h1 className="hero-title">Каждый — фрагмент.<br /><span className="gradient-text">Вместе — картина.</span></h1>
              <p className="hero-lead">Tessera — живая симуляция проектной работы. Команда проходит сессию, а система собирает портрет того, как вы на самом деле работаете вместе: кто кому передаёт, где ждёте, кто помогает и чьи факты решают.</p>
            </div>
            <form className="join-card" onSubmit={(e) => { e.preventDefault(); if (value.length === 6) void submit(); }}>
              <span className="label">Код команды</span>
              <div className="otp">
                {code.map((c, i) => (
                  <input key={i} ref={(el) => { inputs.current[i] = el; }} value={c} inputMode="text" autoCapitalize="characters" maxLength={6}
                    aria-label={`Символ ${i + 1}`} autoFocus={i === 0}
                    onChange={(e) => setAt(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Backspace" && !code[i] && i > 0) inputs.current[i - 1]?.focus(); }} />
                ))}
              </div>
              <button className="btn primary lg block" disabled={busy || value.length < 6}>Войти в команду <ArrowRight size={18} /></button>
              {hasSession && <Link className="btn ghost block" to="/play">Вернуться в свою сессию</Link>}
            </form>
            {demoEnabled && (
              <button className="try-solo" onClick={() => setDemoOpen(true)}>
                <span className="tile lg" style={{ ["--c" as string]: "var(--accent-strong)" }}><Gamepad2 size={20} /></span>
                <span className="stack xs" style={{ textAlign: "left" }}>
                  <strong>Попробовать одному</strong>
                  <span className="small soft">Пять ботов-коллег, панель режиссёра и все механики — за 15 минут</span>
                </span>
                <ArrowRight size={18} />
              </button>
            )}
          </motion.div>
          <HeroPreview />
        </div>
      </section>

      <section className="landing-section">
        <Reveal><div className="stack" style={{ maxWidth: 720 }}>
          <span className="eyebrow">Как это устроено</span>
          <h2 className="section-title">Полтора часа, которые команда запомнит</h2>
        </div></Reveal>
        <div className="steps-grid">
          {[
            { n: "01", t: "Вход и роли", d: "Каждый заходит с телефона по коду и берёт роль: руководитель, аналитик, финансист, инженер, контроль." },
            { n: "02", t: "Брифинг", d: "Легенда проекта, секретные факты, личный выбор до обсуждения, прогноз и командный договор." },
            { n: "03", t: "Работа", d: "Доска, вехи, вбросы клиента, Синхрон, тишина и выезды. Система видит каждое действие." },
            { n: "04", t: "Разбор и ретро", d: "Портрет-мозаика, карта процесса, кто с кем работал — и договорённости на следующий раз." },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}><div className="panel step-card"><span className="step-n">{s.n}</span><h3>{s.t}</h3><p className="soft small">{s.d}</p></div></Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <Reveal><div className="stack" style={{ maxWidth: 720 }}>
          <span className="eyebrow">Механики</span>
          <h2 className="section-title">Всё, что делает команду командой — измеримо</h2>
          <p className="soft">Каждая механика — и упражнение для команды, и поведенческая метрика для исследователя.</p>
        </div></Reveal>
        <div className="mech-grid">
          {MECHANICS.map((m, i) => (
            <Reveal key={m.title} delay={(i % 4) * 0.05}>
              <div className="mech-card"><span className="mech-ico"><m.icon size={20} /></span><strong>{m.title}</strong><span className="small soft">{m.text}</span></div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <Reveal><div className="stack" style={{ maxWidth: 720 }}>
          <span className="eyebrow">Четыре методики</span>
          <h2 className="section-title">Одна задача — четыре способа работать</h2>
        </div></Reveal>
        <div className="cond-strip">
          {CONDITIONS.map((c, i) => (
            <Reveal key={c.key} delay={i * 0.05}>
              <div className="cond-tile" style={{ ["--cc" as string]: condColor(c.key) }}><span className="swatch" style={{ background: "var(--cc)", width: 14, height: 14, borderRadius: 5 }} /><strong>{c.title}</strong><span className="small soft">{c.blurb}</span></div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <Reveal><div className="stack" style={{ maxWidth: 720 }}>
          <span className="eyebrow">С обратной стороны</span>
          <h2 className="section-title">Лаборатория для ведущего и исследователя</h2>
        </div></Reveal>
        <div className="mech-grid three">
          {LAB.map((m, i) => (
            <Reveal key={m.title} delay={(i % 3) * 0.05}>
              <div className="mech-card"><span className="mech-ico alt"><m.icon size={20} /></span><strong>{m.title}</strong><span className="small soft">{m.text}</span></div>
            </Reveal>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <Link to="/facilitator" className="btn lg">Открыть кабинет ведущего <ArrowRight size={18} /></Link>
        </div>
      </section>

      <footer className="landing-foot">
        <Brand />
        <span className="small muted">Данные псевдонимизированы: имена и тексты хранятся отдельно и стираются после сбора.</span>
      </footer>

      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}

const ROLES = [
  { slug: "pm", title: "Руководитель проекта", hint: "сроки, вехи, клиент" },
  { slug: "analyst", title: "Аналитик", hint: "требования и задачи" },
  { slug: "finance", title: "Финансист", hint: "бюджет и стоимость" },
  { slug: "engineer", title: "Инженер", hint: "делает работу" },
  { slug: "qa", title: "Контроль качества", hint: "принимает результат" },
];

function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [role, setRole] = useState("analyst");
  const [condition, setCondition] = useState<string>("random");
  const [name, setName] = useState("");
  const { run, busy } = useAction();
  const start = () => run(async () => {
    const r = await api<{ participant_token: string; facilitator_token: string; team_id: string }>("/api/demo", {
      method: "POST", body: { role_slug: role, condition: condition === "random" ? null : condition, name: name.trim() || null },
    });
    store.set(TOKENS.participant, r.participant_token);
    store.set(TOKENS.director, r.facilitator_token);
    store.set(TOKENS.demoTeam, r.team_id);
    navigate("/play");
  });
  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="stack lg">
        <div className="stack xs">
          <span className="eyebrow">Демо-песочница</span>
          <h2 style={{ fontSize: 26 }}>Сыграйте с командой ботов</h2>
          <p className="soft small">Боты берут задачи, пишут в Эфир, просят помощи и благодарят. Внизу — панель режиссёра: переключайте этапы, запускайте эксперименты, ускоряйте ботов и смотрите глазами любого участника. Демо-данные не попадают в исследование.</p>
        </div>
        <div className="stack sm">
          <span className="label">Ваша роль</span>
          <div className="pick-grid">
            {ROLES.map((r) => (
              <button key={r.slug} className="pick" aria-pressed={role === r.slug} onClick={() => setRole(r.slug)}>
                <span className="stack xs" style={{ gap: 0 }}><span>{r.title}</span><span className="sub">{r.hint}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="stack sm">
          <span className="label">Методика</span>
          <div className="row wrap tight">
            <button className="chip lg" style={{ cursor: "pointer", ...(condition === "random" ? { background: "var(--ink)", color: "var(--ink-inverse)" } : {}) }} onClick={() => setCondition("random")}>Случайная</button>
            {CONDITIONS.map((c) => (
              <button key={c.key} className="chip lg" style={{ cursor: "pointer", ...(condition === c.key ? { background: condColor(c.key), color: "#fff", borderColor: "transparent" } : {}) }} onClick={() => setCondition(c.key)}>{c.title}</button>
            ))}
          </div>
        </div>
        <div className="field"><label>Как вас называть <span className="muted">(необязательно)</span></label>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Вы" /></div>
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn accent lg" disabled={busy} onClick={() => void start()}><Gamepad2 size={18} />Начать</button>
        </div>
      </div>
    </Modal>
  );
}
