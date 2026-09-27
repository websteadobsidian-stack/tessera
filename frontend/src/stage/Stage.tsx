import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Expand, Flag, Radar, Star, Zap } from "lucide-react";
import { api, facilitatorToken } from "../lib/api";
import { phaseTitle } from "../lib/format";
import { useLive } from "../lib/live";
import { shortName } from "../lib/people";
import type { StageState } from "../lib/types";
import { Mosaic } from "../mosaic/Mosaic";
import { TimerPill } from "../participant/Timer";
import { Empty, Loader, Logo, PersonTile, Ring } from "../ui/core";
import { TileBurst } from "../ui/effects";
import { QrCode, useJoinUrl } from "../ui/qr";

/** Экран для проектора: живая мозаика команды, таймер, сыгранность, вход по QR. */
export default function Stage() {
  const { team = "", session = "" } = useParams();
  const token = facilitatorToken();
  const { data, error } = useLive<StageState>(token, (signal) => api(`/api/admin/sessions/${team}/${session}/stage`, { token, signal }),
    { deps: [team, session], fallbackMs: 10000, debounceMs: 200 });
  useEffect(() => { document.documentElement.classList.add("stage-mode"); return () => document.documentElement.classList.remove("stage-mode"); }, []);

  if (!token) return <main className="page narrow"><div className="panel"><Empty title="Нужен вход ведущего">Откройте проектор из кабинета ведущего на этом же устройстве.<div style={{ marginTop: 16 }}><Link className="btn primary" to="/facilitator">Войти</Link></div></Empty></div></main>;
  if (!data) return <main className="stage"><Loader label={error?.message ?? "Подключаем проектор…"} /></main>;
  return <StageView s={data} />;
}

function StageView({ s }: { s: StageState }) {
  const joinUrl = useJoinUrl(s.team.join_code);
  const phase = s.session.phase;
  const lobby = phase === "lobby";
  const people = s.roster;
  const [burst, setBurst] = useState(0);
  const [prevAch, setPrevAch] = useState(s.achievements.length);
  useEffect(() => {
    if (s.achievements.length > prevAch) setBurst(Date.now());
    setPrevAch(s.achievements.length);
  }, [s.achievements.length, prevAch]);

  return (
    <main className="stage">
      <TileBurst trigger={burst} count={80} />
      <header className="stage-head">
        <div className="row" style={{ gap: 14 }}>
          <Logo size={34} alive />
          <div className="stack xs" style={{ gap: 0 }}>
            <strong className="display" style={{ fontSize: 22 }}>{s.team.label || s.team.team_id}</strong>
            <span className="soft">«{s.company.title}» · {s.team.condition_title}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <span className="stage-phase">{phaseTitle(phase)}</span>
          {phase === "work" && <TimerPill session={s.session} big />}
          {!lobby && <span className="stage-code" title={joinUrl}>{s.team.join_code}</span>}
          <button className="btn ghost icon" aria-label="Во весь экран" onClick={() => void document.documentElement.requestFullscreen?.()}><Expand size={18} /></button>
        </div>
      </header>

      {lobby ? (
        <section className="stage-lobby">
          <div className="stack xl" style={{ alignItems: "center" }}>
            <h1 className="stage-title">Заходите в команду</h1>
            <div className="row" style={{ gap: 48, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <div className="stage-qr"><QrCode text={joinUrl} size={300} /></div>
              <div className="stack lg">
                <span className="soft" style={{ fontSize: 22 }}>или код на {new URL(joinUrl).host}</span>
                <span className="stage-bigcode">{s.team.join_code}</span>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 18, justifyContent: "center", minHeight: 110 }}>
              <AnimatePresence>
                {people.map((p) => (
                  <motion.div key={p.participant_id} className="stack xs" style={{ alignItems: "center", width: 110 }}
                    initial={{ scale: 0, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }}>
                    <PersonTile person={p} size="xl" />
                    <span className="strong ellipsis" style={{ fontSize: 16, maxWidth: 110 }}>{shortName(p)}</span>
                    <span className="small muted ellipsis" style={{ maxWidth: 110 }}>{p.role_title}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>
      ) : (
        <section className="stage-main">
          <div className="stage-mosaic">
            <Mosaic tiles={s.tiles} people={people} size={680} live replayable={["debrief", "retro", "closed"].includes(phase)} showLegend={false} minCols={10} highlight={null} />
          </div>
          <aside className="stage-side">
            <div className="stage-card synergy-big">
              <Ring value={s.synergy.score / 100} size={132} stroke={10}><span className="display" style={{ fontSize: 40 }}>{s.synergy.score}</span></Ring>
              <div className="stack xs">
                <span className="eyebrow">Сыгранность</span>
                <span className="display" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.04em" }}>{s.synergy.level.title}</span>
                <span className="soft">{s.synergy.level.text}</span>
              </div>
            </div>
            <div className="stage-card">
              <div className="row between"><span className="eyebrow">Сдано</span><span className="display" style={{ fontSize: 30 }}>{s.tasks_done}<span className="muted" style={{ fontSize: 18 }}> / {s.tasks_total}</span></span></div>
              {s.milestones.map((m) => (
                <div key={m.key} className="stack xs">
                  <div className="row between"><span className="row tight"><Flag size={15} />{m.key}</span><span className="muted">{m.closed_at ? "закрыта" : `${m.done}/${m.tasks}`}</span></div>
                  <div className="bar accent" style={{ height: 10 }}><span style={{ width: `${m.tasks ? (m.done / m.tasks) * 100 : 0}%` }} /></div>
                </div>
              ))}
              {s.table.key_total > 0 && <div className="row between"><span className="soft">Фактов на столе</span><strong style={{ fontSize: 20 }}>{s.table.shared}</strong></div>}
            </div>
            {s.probe.open && (
              <motion.div className="stage-card probe" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <span className="eyebrow row tight" style={{ color: "var(--accent)" }}><Radar size={14} />Синхрон</span>
                <strong style={{ fontSize: 20 }}>{s.probe.open.question}</strong>
                <span className="soft">ответили {s.probe.open.answered} из {s.probe.open.team_size}</span>
              </motion.div>
            )}
            {s.achievements.length > 0 && (
              <div className="row wrap tight">{s.achievements.map((a) => <span key={a.key} className="chip lg gold"><Star size={13} />{a.title}</span>)}</div>
            )}
            <div className="tile-stack" style={{ alignSelf: "flex-start" }}>
              {people.map((p) => <PersonTile key={p.participant_id} person={p} size="lg" muted={!p.online || !!p.away_until} />)}
            </div>
          </aside>
        </section>
      )}

      <AnimatePresence>
        {s.notice && phase === "work" && Date.now() - new Date(s.notice.created_at).getTime() < 60_000 && (
          <motion.div key={s.notice.notice_id} className="stage-notice" initial={{ y: 80, opacity: 0, x: "-50%" }} animate={{ y: 0, opacity: 1, x: "-50%" }} exit={{ y: 80, opacity: 0, x: "-50%" }}>
            <Zap size={22} color="var(--warn)" />
            <div className="stack xs"><strong style={{ fontSize: 20 }}>{s.notice.title}</strong>{s.notice.body && <span className="soft">{s.notice.body}</span>}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
