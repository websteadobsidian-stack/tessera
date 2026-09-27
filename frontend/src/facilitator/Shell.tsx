import { motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowRight, Database, FlaskConical, KeyRound, LayoutGrid, LineChart, LogOut } from "lucide-react";
import { ApiError, TOKENS, api, store } from "../lib/api";
import { Brand, Loader, Logo, Mark, ThemeToggle } from "../ui/core";
import { useAction } from "../ui/overlays";

interface FacCtx {
  token: string;
  full: boolean;
  scope: string | null;
  logout: () => void;
}

const Ctx = createContext<FacCtx | null>(null);

export function useFacilitator() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFacilitator вне кабинета ведущего");
  return v;
}

/** Кабинет ведущего: вход по паролю или «режиссёрский» доступ демо-песочницы (только своя команда). */
export function FacilitatorShell() {
  const [token, setToken] = useState<string | null>(() => store.get(TOKENS.admin) || store.get(TOKENS.director));
  const [me, setMe] = useState<{ full: boolean; team_scope: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    setMe(null);
    api<{ full: boolean; team_scope: string | null }>("/api/admin/me", { token })
      .then(setMe)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          if (store.get(TOKENS.admin) === token) store.del(TOKENS.admin);
          else store.del(TOKENS.director);
          setToken(store.get(TOKENS.admin) || store.get(TOKENS.director));
        } else setFailed(true);
      });
  }, [token]);

  const logout = useCallback(() => {
    if (token) void api("/api/admin/logout", { method: "POST", token }).catch(() => undefined);
    store.del(TOKENS.admin);
    store.del(TOKENS.director);
    setToken(null);
    navigate("/facilitator");
  }, [token, navigate]);

  if (!token) return <Login onToken={(t) => { store.set(TOKENS.admin, t); setToken(t); }} />;
  if (!me) return <main className="page narrow"><Loader label={failed ? "Сервер недоступен" : "Открываем кабинет…"} /></main>;

  const nav = [
    { to: "/facilitator", end: true, title: "Сессии", icon: LayoutGrid, show: true },
    { to: "/facilitator/lab", title: "Лаборатория", icon: FlaskConical, show: me.full },
    { to: "/facilitator/research", title: "Исследование", icon: LineChart, show: me.full },
    { to: "/facilitator/data", title: "Данные", icon: Database, show: me.full },
  ].filter((x) => x.show);

  return (
    <Ctx.Provider value={{ token, full: me.full, scope: me.team_scope, logout }}>
      <div className="fac">
        <aside className="rail">
          <Brand sub="ведущий" to="/facilitator" />
          <nav className="rail-nav">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rail-link ${isActive ? "on" : ""}`}>
                <n.icon size={18} /><span>{n.title}</span>
              </NavLink>
            ))}
          </nav>
          <div className="rail-foot">
            {!me.full && (
              <div className="rail-note">
                <span className="tiny muted">Режиссёрский доступ к демо-команде {me.team_scope}.</span>
                <button className="btn xs" onClick={() => { store.del(TOKENS.director); setToken(store.get(TOKENS.admin)); }}><KeyRound size={12} />Войти по паролю</button>
              </div>
            )}
            <div className="row between">
              <ThemeToggle />
              <button className="btn ghost sm" onClick={logout}><LogOut size={15} />Выйти</button>
            </div>
          </div>
        </aside>
        <div className="fac-main">
          <Outlet />
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Login({ onToken }: { onToken: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const { run, busy } = useAction();
  const submit = () => run(async () => {
    const r = await api<{ token: string }>("/api/admin/login", { method: "POST", body: { password } });
    onToken(r.token);
  });
  return (
    <main className="login">
      <motion.div className="panel login-card stack xl" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
          <Logo size={48} alive />
          <h2>Кабинет ведущего</h2>
          <p className="soft small">Команды, живой пульт, эксперименты и данные исследования.</p>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="field">
            <label htmlFor="pw">Пароль</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" autoFocus value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ height: 50, fontSize: 16 }} />
          </div>
          <button className="btn primary lg block" disabled={busy || !password}>Войти <ArrowRight size={18} /></button>
        </form>
        <span className="tiny muted center">Пароль задаётся переменной ADMIN_PASSWORD при запуске сервера.</span>
      </motion.div>
    </main>
  );
}

/** Заголовок страницы кабинета. */
export function PageHead({ eyebrow, title, children, lead }: { eyebrow?: string; title: ReactNode; children?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack sm" style={{ minWidth: 0 }}>
        {eyebrow && <span className="eyebrow"><Mark />{eyebrow}</span>}
        <h1 style={{ fontSize: "clamp(28px, 3.4vw, 40px)" }}>{title}</h1>
        {lead && <p className="soft" style={{ maxWidth: 680 }}>{lead}</p>}
      </div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}
