import { useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useNavigate } from "react-router-dom";
import { TOKENS, api, store, usePoll } from "../api";
import { Brand, Empty, Icon, ThemeToggle, useAction } from "../components/ui";
import { CONDITIONS, PHASES, clock, condColor, conditionTitle, phaseTitle, plural } from "../format";
import type { Condition, Phase } from "../types";

export function useAdminToken() {
  return store.get(TOKENS.admin);
}

/** Страницы ведущего не монтируются (и не опрашивают API) без токена. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  return store.get(TOKENS.admin) ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

export function AdminShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const token = useAdminToken();
  const nav = useNavigate();
  if (!token) return <Navigate to="/admin/login" replace />;
  const logout = async () => {
    try { await api("/api/admin/logout", { method: "POST", token }); } catch { /* всё равно выходим */ }
    store.del(TOKENS.admin);
    nav("/admin/login");
  };
  return (
    <>
      <header className="topbar">
        <Brand sub="пульт ведущего" to="/admin" />
        <nav className="row" style={{ gap: 4, marginLeft: 12 }}>
          <NavLink to="/admin" end className={({ isActive }) => `btn sm ${isActive ? "" : "ghost"}`}>Команды</NavLink>
          <NavLink to="/admin/research" className={({ isActive }) => `btn sm ${isActive ? "" : "ghost"}`}>Исследование</NavLink>
        </nav>
        <div className="spacer" />
        <ThemeToggle />
        <button className="btn ghost sm" onClick={logout} aria-label="Выйти"><Icon name="logout" /><span className="hide-sm">Выйти</span></button>
      </header>
      <main className={`page ${wide ? "wide" : ""}`}>{children}</main>
    </>
  );
}

/** Ошибка 401 от API ведущего — токен истёк. */
export function useAdminGuard(status?: number) {
  if (status === 401) {
    store.del(TOKENS.admin);
    return <Navigate to="/admin/login" replace />;
  }
  return null;
}

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const { run, busy } = useAction();
  const nav = useNavigate();
  const login = () => run(async () => {
    const r = await api<{ token: string }>("/api/admin/login", { method: "POST", body: { password } });
    store.set(TOKENS.admin, r.token);
    nav("/admin");
  });
  return (
    <>
      <header className="topbar"><Brand /><div className="spacer" /><ThemeToggle /></header>
      <main className="page" style={{ maxWidth: 420, paddingTop: 72 }}>
        <div className="card stack lg">
          <div className="stack sm"><span className="section-title">Пульт ведущего</span><h2>Вход</h2></div>
          <div className="field"><label htmlFor="pw">Пароль</label>
            <input id="pw" type="password" className="input" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} /></div>
          <button className="btn primary lg block" disabled={busy || !password} onClick={login}>Войти</button>
          <p className="tiny muted">Пароль задаётся переменной <span className="kbd">ADMIN_PASSWORD</span> в файле .env.</p>
        </div>
      </main>
    </>
  );
}

interface Overview {
  teams: {
    team_id: string; join_code: string; condition: Condition; label: string; scenario_version: string; created_at: string;
    participants: number;
    sessions: { team_id: string; session_id: string; phase: Phase; phase_changed_at: string; work_started_at: string | null; events: number }[];
  }[];
  scenarios: { version: string; title: string }[];
}

export function AdminHome() {
  const token = useAdminToken()!;
  const { data, error, reload } = usePoll(() => api<Overview>("/api/admin/overview", { token }), 5000, [token]);
  const [condition, setCondition] = useState<Condition>("kanban");
  const [label, setLabel] = useState("");
  const { run, busy } = useAction();
  const nav = useNavigate();
  const guard = useAdminGuard(error?.status);
  if (guard) return guard;

  const create = () => run(async () => {
    const r = await api<{ team_id: string; session_id: string }>("/api/admin/teams", { method: "POST", token, body: { condition, label } });
    setLabel("");
    nav(`/admin/s/${r.team_id}/${r.session_id}`);
  });

  return (
    <AdminShell>
      <div className="stack lg">
        <div className="row between wrap">
          <div className="stack sm"><span className="section-title">Интенсивы</span><h1>Команды</h1></div>
        </div>

        <section className="card stack">
          <div className="card-head" style={{ marginBottom: 0 }}><h3>Новая команда</h3>
            <span className="hint">сценарий, задачи и вбросы одинаковы — меняется только методика</span></div>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {CONDITIONS.map((c) => (
              <button key={c.key} className="pick" aria-pressed={condition === c.key} onClick={() => setCondition(c.key)}
                style={{ flexDirection: "column", alignItems: "flex-start", padding: 14, gap: 4 }}>
                <span className="row" style={{ gap: 8 }}><span className="swatch" style={{ background: condColor(c.key) }} /><strong>{c.title}</strong></span>
                <span className="small" style={{ opacity: 0.75, fontWeight: 400, textAlign: "left" }}>{c.blurb}</span>
              </button>
            ))}
          </div>
          <div className="row wrap">
            <input className="input grow" style={{ minWidth: 220 }} placeholder="Подпись: группа, дата, пара" value={label}
              onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <button className="btn primary" disabled={busy} onClick={create}><Icon name="plus" />Создать команду</button>
          </div>
        </section>

        {!data ? <Empty title="Загрузка…" icon="clock" /> : data.teams.length === 0 ? (
          <div className="card"><Empty title="Команд пока нет" icon="users">Создайте первую команду — она получит код для входа.</Empty></div>
        ) : (
          <div className="grid-3">
            {data.teams.map((t) => {
              const last = t.sessions[t.sessions.length - 1];
              return (
                <div key={t.team_id} className="card stack">
                  <div className="row between top">
                    <div className="stack" style={{ gap: 2 }}>
                      <div className="row" style={{ gap: 8 }}><h3>{t.team_id}</h3>
                        <span className="chip"><span className="swatch" style={{ background: condColor(t.condition) }} />{conditionTitle(t.condition)}</span></div>
                      <span className="small muted">{t.label || "без подписи"}</span>
                    </div>
                    <span className="join-code" style={{ fontSize: 18 }}>{t.join_code}</span>
                  </div>
                  <div className="row wrap small soft" style={{ gap: 14 }}>
                    <span className="row" style={{ gap: 6 }}><Icon name="users" size={14} />{t.participants} {plural(t.participants, "участник", "участника", "участников")}</span>
                    {last && <span className="row" style={{ gap: 6 }}><Icon name="file" size={14} />{last.events} событий</span>}
                  </div>
                  <div className="stack sm">
                    {t.sessions.map((s) => (
                      <Link key={s.session_id} to={`/admin/s/${t.team_id}/${s.session_id}`} className="row between"
                        style={{ padding: "8px 10px", borderRadius: 10, background: "var(--surface-2)", color: "var(--ink)" }}>
                        <span className="row" style={{ gap: 8 }}><strong className="mono small">{s.session_id}</strong>
                          <span className={`chip ${s.phase === "work" ? "good" : s.phase === "closed" ? "" : "accent"}`}>{phaseTitle(s.phase)}</span></span>
                        <span className="row small muted" style={{ gap: 4 }}>{clock(s.phase_changed_at)}<Icon name="arrow" size={14} /></span>
                      </Link>
                    ))}
                  </div>
                  {last?.phase === "closed" && (
                    <button className="btn sm" disabled={busy} onClick={() => run(async () => {
                      const r = await api<{ session_id: string }>(`/api/admin/teams/${t.team_id}/sessions`, { method: "POST", token });
                      reload();
                      nav(`/admin/s/${t.team_id}/${r.session_id}`);
                    })}><Icon name="plus" />Следующая сессия</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export const PHASE_HINT: Record<Phase, string> = {
  lobby: "Участники входят по коду, дают согласие и выбирают роли.",
  entry: "Входная анкета: психологическая безопасность и ясность целей.",
  briefing: "Легенда компании, правила методики, скрытая информация ролей.",
  work: "Запускается таймер и сроки вех. Доска открыта, можно делать вбросы.",
  pulse: "Опрос на 1–2 минуты и оценки коллег.",
  debrief: "Команда видит карту своего процесса. Разбор ведёте вы.",
  exit: "Повтор шкал и рефлексия.",
  closed: "Сессия завершена, данные зафиксированы.",
};

export { PHASES };
