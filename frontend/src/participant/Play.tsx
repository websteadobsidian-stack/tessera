import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { LogOut, Radio } from "lucide-react";
import { TOKENS, api, store } from "../lib/api";
import { phaseTitle } from "../lib/format";
import { useLive } from "../lib/live";
import { fullName } from "../lib/people";
import type { ParticipantState } from "../lib/types";
import { Brand, Empty, LevelMeter, Loader, PersonTile, ThemeToggle } from "../ui/core";
import { PhaseTransition } from "../ui/effects";
import { Briefing } from "./Briefing";
import { PlayProvider, usePlay } from "./context";
import { ParticipantDebrief } from "./Debrief";
import { Director } from "./Director";
import { Closed, Lobby } from "./Lobby";
import { Onboarding } from "./Onboarding";
import { Banners, Overlays } from "./Overlays";
import { Retro } from "./Retro";
import { SurveyPhase } from "./SurveyFlow";
import { TimerPill } from "./Timer";
import { Work } from "./Work";

export default function Play() {
  const token = store.get(TOKENS.participant);
  return token ? <PlayScreen token={token} /> : <Navigate to="/" replace />;
}

function PlayScreen({ token }: { token: string }) {
  const { data, error, reload, connected } = useLive<ParticipantState>(token,
    (signal) => api<ParticipantState>("/api/p/state", { token, signal }), { fallbackMs: 15000 });
  const phase = data?.session.phase;
  // Новый этап — с начала страницы (иначе остаёмся прокрученными с прошлого экрана).
  useEffect(() => { window.scrollTo({ top: 0 }); }, [phase]);

  if (error?.status === 401) {
    store.del(TOKENS.participant);
    return <Gone />;
  }
  if (!data) return <><TopShell /><main className="page narrow"><Loader label={error ? error.message : "Собираем мозаику…"} /></main></>;

  if (!data.me) {
    return (
      <>
        <TopShell company={data.company.title} />
        <Onboarding state={data} token={token} reload={reload} />
      </>
    );
  }
  return (
    <PlayProvider state={data} token={token} reload={reload}>
      <TopBar connected={connected} />
      <Banners />
      <PhaseTransition phase={data.session.phase}>
        <Screen />
      </PhaseTransition>
      <Overlays />
      {data.team.demo_kind === "sandbox" && <Director />}
    </PlayProvider>
  );
}

function Screen() {
  const { state } = usePlay();
  const phase = state.session.phase;
  if (phase === "lobby") return <Lobby />;
  if (phase === "entry" || phase === "pulse" || phase === "exit") return <SurveyPhase />;
  if (phase === "briefing") return <Briefing />;
  if (phase === "work") return <Work />;
  if (phase === "debrief") return <ParticipantDebrief />;
  if (phase === "retro") return state.mechanics.retro ? <Retro /> : <ParticipantDebrief />;
  return <Closed />;
}

function TopShell({ company }: { company?: string }) {
  return (
    <header className="topbar">
      <Brand sub={company} />
      <div className="spacer" />
      <ThemeToggle />
    </header>
  );
}

function TopBar({ connected }: { connected: boolean }) {
  const { state, me } = usePlay();
  const [menu, setMenu] = useState(false);
  const online = state.roster.filter((r) => r.online).length;
  const synergy = state.synergy;
  return (
    <header className="topbar">
      <Brand sub={state.company.title} />
      <span className="chip lg hide-sm" style={{ color: `var(--cond-${state.team.condition})` }}>
        <span className="dot" /><span style={{ color: "var(--ink-2)" }}>{state.team.condition_title}</span>
      </span>
      <div className="spacer" />
      {state.session.phase === "work" ? <TimerPill session={state.session} /> : (
        <span className="chip lg outline hide-sm">{phaseTitle(state.session.phase)}</span>
      )}
      {synergy && state.mechanics.synergy && state.session.phase === "work" && (
        <span className="hide-sm"><LevelMeter index={synergy.level.index} score={synergy.score} title={synergy.level.title} /></span>
      )}
      <div className="tile-stack hide-sm" title={`${online} из ${state.roster.length} на связи`}>
        {state.roster.slice(0, 6).map((p) => <PersonTile key={p.participant_id} person={p} size="sm" muted={!p.online} />)}
      </div>
      <span title={connected ? "Живое обновление" : "Переподключение…"} style={{ color: connected ? "var(--good)" : "var(--ink-3)" }}>
        <Radio size={16} />
      </span>
      <div style={{ position: "relative" }}>
        <button className="btn ghost icon sm" style={{ width: 38, height: 38, padding: 0 }} onClick={() => setMenu((m) => !m)} aria-label="Меню">
          <PersonTile person={me} size="sm" />
        </button>
        <AnimatePresence>
          {menu && (
            <motion.div className="panel solid" style={{ position: "absolute", right: 0, top: 46, width: 260, padding: 12, zIndex: 50 }}
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <div className="row" style={{ gap: 10, padding: 6 }}>
                <PersonTile person={me} size="lg" />
                <div className="stack xs"><strong>{fullName(me)}</strong><span className="tiny muted mono">{me.participant_id}</span></div>
              </div>
              <hr className="divider" style={{ margin: "8px 0" }} />
              <div className="row between" style={{ padding: "4px 6px" }}><span className="small soft">Тема</span><ThemeToggle /></div>
              <Link to="/" className="btn ghost sm block" style={{ justifyContent: "flex-start" }} onClick={() => setMenu(false)}>
                <LogOut size={15} /> На главную
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

function Gone() {
  return (
    <>
      <TopShell />
      <main className="page narrow">
        <div className="panel"><Empty title="Сессия не найдена">
          Возможно, вы отказались от участия или ведущий пересоздал команду.
          <div style={{ marginTop: 16 }}><Link className="btn primary" to="/">Ввести код команды</Link></div>
        </Empty></div>
      </main>
    </>
  );
}
