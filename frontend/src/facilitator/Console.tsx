import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ChevronRight, Copy, Gauge, LayoutDashboard, MessagesSquare, MonitorPlay, QrCode as QrIcon, Radio, Scale, Settings2, Sparkles, Users,
} from "lucide-react";
import { Board, TaskSheet } from "../board/Board";
import { api } from "../lib/api";
import { PHASES, condColor, num, phaseIndex, phaseTitle } from "../lib/format";
import { useStored } from "../lib/hooks";
import { useLive } from "../lib/live";
import type { AdminLive, Debrief, Phase } from "../lib/types";
import { SynergyCard } from "../charts/Insights";
import { DebriefHero, TeamDebrief } from "../participant/Debrief";
import { TimerPill } from "../participant/Timer";
import { Empty, Loader, Tabs } from "../ui/core";
import { Confirm, Modal, useToast } from "../ui/overlays";
import { QrCode, useJoinUrl } from "../ui/qr";
import { AirAdmin, Feed, Interventions, PeoplePanel, Schedule, SettingsPanel, Signals, SocialPanel, TableAdmin, useFire } from "./ConsoleParts";
import { useFacilitator } from "./Shell";

type Tab = "live" | "people" | "table" | "air" | "debrief" | "settings";

export function Console() {
  const { team = "", session = "" } = useParams();
  // Своё состояние (вкладка, живой канал) у каждой сессии: при переходе между сессиями — с чистого листа.
  return <ConsoleView key={`${team}/${session}`} team={team} session={session} />;
}

function ConsoleView({ team, session }: { team: string; session: string }) {
  const { token } = useFacilitator();
  const { data, error, reload, connected } = useLive<AdminLive>(token,
    (signal) => api(`/api/admin/sessions/${team}/${session}`, { token, signal }), { deps: [team, session], fallbackMs: 15000, debounceMs: 250 });
  const [tab, setTab] = useStored<Tab>(`tessera.console.${team}.${session}`, "live");

  if (error && !data) return <main className="page"><div className="panel"><Empty title="Сессия недоступна">{error.message}</Empty></div></main>;
  if (!data) return <main className="page"><Loader label="Подключаемся к сессии…" /></main>;
  const live = data;
  const tabs: { key: Tab; title: string; icon: typeof Users; count?: number }[] = [
    { key: "live", title: "Пульт", icon: LayoutDashboard, count: live.signals.filter((s) => s.severity === "bad").length },
    { key: "people", title: "Люди", icon: Users },
    ...(live.table ? [{ key: "table" as Tab, title: "Стол", icon: Scale }] : []),
    ...(live.mechanics.chat ? [{ key: "air" as Tab, title: "Эфир", icon: MessagesSquare }] : []),
    { key: "debrief", title: "Разбор", icon: Sparkles },
    { key: "settings", title: "Параметры", icon: Settings2 },
  ];
  return (
    <main className="page wide stack lg" style={{ paddingTop: 20 }}>
      <ConsoleHead live={live} reload={reload} connected={connected} />
      <Tabs id="console" value={tab} onChange={setTab} items={tabs.map((t) => ({ key: t.key, title: t.title, icon: <t.icon size={15} />, count: t.count }))} />
      {tab === "live" && <LiveTab live={live} reload={reload} />}
      {tab === "people" && <div className="grid-2" style={{ alignItems: "start" }}><div className="panel"><PeoplePanel live={live} /></div><div className="panel"><SocialPanel live={live} /></div></div>}
      {tab === "table" && <div className="panel"><TableAdmin live={live} /></div>}
      {tab === "air" && <div className="panel"><AirAdmin live={live} /></div>}
      {tab === "debrief" && <DebriefTab live={live} />}
      {tab === "settings" && <div className="panel"><SettingsPanel live={live} reload={reload} /></div>}
    </main>
  );
}

function ConsoleHead({ live, reload, connected }: { live: AdminLive; reload: () => Promise<void>; connected: boolean }) {
  const { post, busy } = useFire(live, reload);
  const toast = useToast();
  const [qr, setQr] = useState(false);
  const [confirm, setConfirm] = useState<Phase | null>(null);
  const joinUrl = useJoinUrl(live.team.join_code);
  const order = PHASES.map((p) => p.key).filter((p) => p !== "retro" || live.mechanics.retro);
  const idx = order.indexOf(live.session.phase);
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const go = (p: Phase) => post("/phase", { phase: p }, `Этап: ${phaseTitle(p)}`);
  const ask = (p: Phase) => (p === "work" || p === "closed" || phaseIndex(p) < phaseIndex(live.session.phase) ? setConfirm(p) : void go(p));
  return (
    <section className="console-head">
      <div className="row between wrap top" style={{ gap: 16 }}>
        <div className="stack sm" style={{ minWidth: 0 }}>
          <Link to="/facilitator" className="row tight small muted" style={{ textDecoration: "none" }}><ArrowLeft size={14} />Все сессии</Link>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 style={{ fontSize: "clamp(24px, 3vw, 34px)" }}>{live.team.label || live.team.team_id}</h1>
            <span className="chip lg" style={{ color: condColor(live.team.condition) }}><span className="dot" /><span style={{ color: "var(--ink-2)" }}>{live.team.condition_title}</span></span>
            {live.team.protocol.title && <span className="chip lg outline">{live.team.protocol.title}</span>}
            {live.team.is_demo && <span className="chip lg accent">демо</span>}
          </div>
          <span className="tiny muted">{live.team.team_id} · {live.session.session_id} · сценарий {live.team.scenario_version} · {live.events} событий
            {live.session.time_scale !== 1 && ` · время ×${num(live.session.time_scale, 2)}`}</span>
        </div>
        <div className="row wrap">
          <span title={connected ? "Живое обновление" : "Переподключение…"} style={{ color: connected ? "var(--good)" : "var(--ink-3)" }}><Radio size={16} /></span>
          {live.session.phase === "work" && <TimerPill session={live.session} big />}
          <button className="code-pill big" onClick={() => { void navigator.clipboard?.writeText(live.team.join_code); toast("Код скопирован"); }} title="Код для входа">
            {live.team.join_code}<Copy size={14} />
          </button>
          <button className="btn" onClick={() => setQr(true)}><QrIcon size={16} />QR</button>
          <Link className="btn" to={`/stage/${live.team.team_id}/${live.session.session_id}`} target="_blank"><MonitorPlay size={16} />Проектор</Link>
        </div>
      </div>
      <div className="phase-rail">
        {order.map((p, i) => {
          const state = i < idx ? "past" : i === idx ? "now" : "next";
          return (
            <button key={p} className={`phase-step ${state}`} disabled={busy || i === idx} onClick={() => ask(p)} title={PHASES.find((x) => x.key === p)?.hint}>
              <span className="pdot">{i < idx ? "✓" : i + 1}</span>
              <span className="plabel">{PHASES.find((x) => x.key === p)?.short}</span>
              {i === idx && <motion.span layoutId="phase-glow" className="pglow" />}
            </button>
          );
        })}
        {next && (
          <button className="btn accent" disabled={busy} onClick={() => ask(next)}>
            Дальше: {phaseTitle(next)}<ChevronRight size={16} />
          </button>
        )}
      </div>
      <p className="tiny muted" style={{ marginTop: -4 }}>{PHASES.find((x) => x.key === live.session.phase)?.hint}</p>

      <Modal open={qr} onClose={() => setQr(false)}>
        <div className="stack lg" style={{ alignItems: "center", textAlign: "center" }}>
          <h2 style={{ fontSize: 22 }}>Вход в команду</h2>
          <QrCode text={joinUrl} size={260} />
          <span className="display" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "0.12em" }}>{live.team.join_code}</span>
          <span className="small muted mono" style={{ wordBreak: "break-all" }}>{joinUrl}</span>
        </div>
      </Modal>
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => confirm && void go(confirm)}
        title={confirm === "work" ? "Начать рабочую сессию?" : confirm === "closed" ? "Завершить сессию?" : `Вернуться к этапу «${confirm ? phaseTitle(confirm) : ""}»?`}
        text={confirm === "work" ? "Запустится таймер, сроки вех и таймлайн протокола." : confirm === "closed" ? "Участники увидят финальный портрет. Вход по коду закроется." : "Участники увидят этот этап снова."}
        confirm={confirm === "work" ? "Начать" : confirm === "closed" ? "Завершить" : "Вернуться"} />
    </section>
  );
}

function LiveTab({ live, reload }: { live: AdminLive; reload: () => Promise<void> }) {
  const { fire, post, busy } = useFire(live, reload);
  const [open, setOpen] = useState<string | null>(null);
  const task = live.tasks.find((t) => t.key === open) ?? null;
  const done = live.tasks.filter((t) => t.stage === "Сдача").length;
  return (
    <div className="console-grid">
      <div className="stack lg" style={{ minWidth: 0 }}>
        <div className="grid-2">
          <div className="panel stack">
            <div className="panel-title"><Gauge size={17} /><h3>Сигналы</h3></div>
            <Signals live={live} fire={fire} busy={busy} />
          </div>
          <div className="panel stack">
            <SynergyCard synergy={live.synergy} compact />
            <div className="row wrap tight">
              <span className="chip lg">сдано {done} из {live.tasks.length}</span>
              {live.milestones.map((m) => <span key={m.key} className={`chip lg ${m.closed_at ? "good" : ""}`}>{m.key} · {m.done}/{m.tasks}</span>)}
              {live.achievements.map((a) => <span key={a.key} className="chip lg gold" title={a.text}>★ {a.title}</span>)}
            </div>
          </div>
        </div>
        <div className="panel pad-sm stack sm">
          <div className="row between" style={{ padding: "4px 6px" }}><h3>Доска команды</h3><span className="tiny muted">только просмотр · нажмите на задачу</span></div>
          <Board tasks={live.tasks} roster={live.roster} condition={live.team.condition} session={live.session} help={live.help} onOpen={setOpen} />
        </div>
        <div className="grid-2">
          <div className="panel stack"><h3>Люди</h3><PeoplePanel live={live} /></div>
          <div className="panel stack"><h3>Лента</h3><Feed live={live} /></div>
        </div>
      </div>
      <aside className="stack lg console-side">
        <div className="panel stack"><h3>Эксперименты</h3><Interventions live={live} fire={fire} busy={busy} /></div>
        <div className="panel stack"><h3>Таймлайн протокола</h3><Schedule live={live} post={post} busy={busy} /></div>
      </aside>
      <TaskSheet task={task} open={!!open} onClose={() => setOpen(null)} roster={live.roster} condition={live.team.condition} session={live.session} />
    </div>
  );
}

function DebriefTab({ live }: { live: AdminLive }) {
  const { token } = useFacilitator();
  const [data, setData] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = live.team.team_id, s = live.session.session_id;
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    setError(null);
    api<Debrief>(`/api/admin/sessions/${t}/${s}/debrief`, { token }).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [t, s, token, stamp]);
  if (!data) return <Loader label={error ?? "Строим разбор…"} />;
  if (!data.events) return <div className="panel"><Empty title="Разбор появится после работы">Пока нет событий — начните рабочую сессию.</Empty></div>;
  return (
    <div className="stack xl">
      <DebriefHero data={data} exportName={`tessera-${t}-${s}.png`}
        aside={<button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setStamp(Date.now())}>Обновить разбор</button>} />
      <TeamDebrief data={data} audience="facilitator" />
    </div>
  );
}
