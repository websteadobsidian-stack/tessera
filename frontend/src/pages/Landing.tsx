import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TOKENS, api, store } from "../api";
import { Brand, Icon, ThemeToggle, useAction } from "../components/ui";

const TILES = ["var(--stage-1)", "var(--stage-2)", "var(--stage-3)", "var(--stage-4)", "var(--stage-5)", "var(--ink)", "var(--surface-3)", "var(--stage-0)"];

export default function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const { run, busy } = useAction();
  const existing = store.get(TOKENS.participant);

  const join = () => run(async () => {
    const r = await api<{ token: string }>("/api/join", { method: "POST", body: { code: code.trim() } });
    store.set(TOKENS.participant, r.token);
    nav("/play");
  });

  return (
    <>
      <header className="topbar"><Brand sub="командная работа как мозаика" /><div className="spacer" /><ThemeToggle /></header>
      <main className="page" style={{ paddingTop: 48 }}>
        <div className="grid-2" style={{ alignItems: "center", gap: 48 }}>
          <div className="stack lg">
            <span className="chip outline lg" style={{ alignSelf: "flex-start" }}><Icon name="sparkle" size={14} />учебная среда · исследование</span>
            <h1 style={{ fontSize: "clamp(34px, 5vw, 56px)" }}>Каждый — фрагмент.<br />Вместе — картина.</h1>
            <p className="soft" style={{ fontSize: 17, maxWidth: 520 }}>
              Команда получает в управление компанию «Меридиан»: проекты, вехи, сроки и клиентов.
              Вы работаете вживую за одним столом, а Tessera собирает след процесса — и после сессии
              показывает команде карту того, как на самом деле шла работа.
            </p>
            <div className="card stack" style={{ maxWidth: 460 }}>
              <label htmlFor="code" className="label">Код команды</label>
              <input id="code" className="input code-input" maxLength={6} autoComplete="off" autoCapitalize="characters"
                placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length >= 4 && join()} />
              <button className="btn primary lg block" disabled={busy || code.length < 4} onClick={join}>
                Войти в команду <Icon name="arrow" />
              </button>
              {existing && <Link to="/play" className="small" style={{ textAlign: "center" }}>Вернуться в свою команду</Link>}
              <p className="tiny muted" style={{ textAlign: "center" }}>Код покажет ведущий на экране.</p>
            </div>
          </div>
          <div className="hero-mosaic" aria-hidden>
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} style={{ background: TILES[(i * 7 + (i % 5) * 3) % TILES.length], animationDelay: `${(i % 8) * 40 + Math.floor(i / 8) * 50}ms`, opacity: 0.35 + ((i * 13) % 10) / 16 }} />
            ))}
          </div>
        </div>
        <div className="grid-3" style={{ marginTop: 64 }}>
          {[
            ["users", "Живое общение", "Система не заменяет разговор. Она фиксирует его результат: статусы, передачи задач, решения."],
            ["chart", "Разбор по фактам", "После сессии команда видит карту своего процесса: где ждали, что возвращали, кто стал узлом."],
            ["lock", "Бережно к данным", "В исследовательской базе — только коды участников. Данные не влияют на оценки."],
          ].map(([icon, title, text]) => (
            <div key={title} className="stack sm">
              <span className="avatar lg"><Icon name={icon} size={18} /></span>
              <h3>{title}</h3>
              <p className="soft small">{text}</p>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 56, textAlign: "center" }}>
          Проводите интенсив? <Link to="/admin">Пульт ведущего</Link>
        </p>
      </main>
    </>
  );
}
