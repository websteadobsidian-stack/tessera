import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft, CalendarRange, Crown, Flag, Gauge, HeartHandshake, KanbanSquare, LifeBuoy, ListChecks,
  MessagesSquare, Scale, Users, X,
} from "lucide-react";
import { Board, TaskSheet, type BoardFilter } from "../board/Board";
import type { OnAction } from "../board/permissions";
import { STAGES } from "../lib/format";
import { useMedia, useStored } from "../lib/hooks";
import { capitalize, personColor, shortName } from "../lib/people";
import { KudosIcon, PersonTile, Segmented, Tabs, WeatherIcon } from "../ui/core";
import { Modal, useToast } from "../ui/overlays";
import { NOBODY, nobodyOption, taskOptions } from "../ui/options";
import { Select } from "../ui/select";
import { AirPanel } from "./Air";
import { usePlay } from "./context";
import { PlanPanel } from "./Plan";
import { TablePanel } from "./Table";
import { TeamPanel } from "./Team";
import { Countdown } from "./Timer";
import { WorkUiCtx, type DockTab, type WorkUi } from "./workui";

export function Work() {
  const { state, me, act, busy } = usePlay();
  const m = state.mechanics;
  const narrow = useMedia("(max-width: 1180px)");
  const tabs = useMemo(() => {
    const out: { key: DockTab; title: string; icon: typeof Scale }[] = [];
    if (state.table) out.push({ key: "table", title: "Стол", icon: Scale });
    if (m.chat) out.push({ key: "air", title: "Эфир", icon: MessagesSquare });
    out.push({ key: "team", title: "Команда", icon: Users });
    out.push({ key: "plan", title: "План", icon: ListChecks });
    return out;
  }, [state.table, m.chat]);
  const [tab, setTab] = useStored<DockTab>(`tessera.dock.${me.participant_id}`, tabs[0].key);
  const [view, setView] = useState<"board" | DockTab>("board");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [helpFor, setHelpFor] = useState<string | null | undefined>(undefined);
  const [kudosTo, setKudosTo] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState<BoardFilter>("all");
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  // Плавающие кнопки: на телефоне — только на доске (в Эфире и других вкладках им не место).
  const showQuickbar = !narrow || view === "board";
  useEffect(() => {
    document.body.classList.toggle("has-quickbar", showQuickbar);
    return () => document.body.classList.remove("has-quickbar");
  }, [showQuickbar]);

  // Непрочитанное в Эфире и просьбы о помощи от коллег.
  const [airSeen, setAirSeen] = useStored<number>(`tessera.air.${me.participant_id}`, 0);
  const lastAir = state.air[state.air.length - 1]?.message_id ?? 0;
  const airVisible = narrow ? view === "air" : activeTab === "air";
  useEffect(() => { if (airVisible && lastAir > airSeen) setAirSeen(lastAir); }, [airVisible, lastAir, airSeen, setAirSeen]);
  const unread = state.air.filter((x) => x.message_id > airSeen && x.participant_id !== me.participant_id).length;
  const helpCount = state.help.filter((h) => !h.resolved_at && !h.helper_id && h.participant_id !== me.participant_id).length;
  const counts: Partial<Record<DockTab, number>> = { air: airVisible ? 0 : unread, team: helpCount };

  const go = useCallback((t: DockTab) => { setTab(t); setView(t); }, [setTab]);
  const ui: WorkUi = useMemo(() => ({
    openTask: (key: string) => setOpenKey(key),
    discuss: (key: string) => { setOpenKey(null); setDraft((d) => (d.includes(`#${key}`) ? d : `#${key} ${d}`)); go("air"); },
    askHelp: (key?: string) => { setOpenKey(null); setHelpFor(key ?? null); },
    thank: (pid?: string) => setKudosTo(pid ?? null),
    go, draft, setDraft,
  }), [go, draft]);

  const onAction: OnAction = useCallback((key, action, body) => act(`/api/p/tasks/${key}/${action}`, body ?? {}), [act]);
  const viewer = { participant_id: me.participant_id, is_pm: me.is_pm, away: !!me.away_until };
  const openTask = state.tasks.find((t) => t.key === openKey) ?? null;
  const myOpenHelp = state.help.find((h) => h.participant_id === me.participant_id && !h.resolved_at);

  const board = (
    <div className="work-main">
      <WorkStrip filter={filter} setFilter={setFilter} />
      <Board tasks={state.tasks} roster={state.roster} condition={state.team.condition} session={state.session}
        viewer={viewer} homeStages={me.home_stages} meSlot={me.color_slot} filter={filter} help={state.help}
        onAction={onAction} onOpen={setOpenKey} busy={busy} />
    </div>
  );
  const panel = (t: DockTab) =>
    t === "table" ? <TablePanel /> : t === "air" ? <AirPanel height={narrow ? "calc(100dvh - var(--topbar-h) - 196px)" : undefined} />
      : t === "team" ? <TeamPanel /> : <PlanPanel />;

  return (
    <WorkUiCtx.Provider value={ui}>
      <main className="page wide" style={{ paddingTop: 16 }}>
        {narrow ? (
          view === "board" ? board : (
            <div className={`panel ${view === "air" ? "pad-sm" : ""}`} style={{ minHeight: "60vh" }}>
              {panel(view)}
            </div>
          )
        ) : (
          <div className="work">
            {board}
            <aside className="panel pad-0 dock">
              <Tabs id="dock" value={activeTab} onChange={setTab}
                items={tabs.map((t) => ({ key: t.key, title: t.title, icon: <t.icon size={15} />, count: counts[t.key] }))} />
              <div className={`dock-body ${activeTab === "air" ? "air-body" : ""}`}>{panel(activeTab)}</div>
            </aside>
          </div>
        )}
      </main>

      {showQuickbar && <Quickbar myHelp={!!myOpenHelp} onHelp={() => (myOpenHelp ? act(`/api/p/help/${myOpenHelp.help_id}/resolve`, {}, "Просьба закрыта") : ui.askHelp())}
        onThanks={() => ui.thank()} />}

      {narrow && (
        <nav className="mobile-nav" style={{ ["--n" as string]: tabs.length + 1 }} role="tablist">
          <button role="tab" aria-selected={view === "board"} onClick={() => setView("board")}><KanbanSquare size={20} />Доска</button>
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={view === t.key} onClick={() => go(t.key)}>
              <t.icon size={20} />{t.title}
              {!!counts[t.key] && <span className="count">{counts[t.key]}</span>}
            </button>
          ))}
        </nav>
      )}

      <TaskSheet task={openTask} open={!!openKey} onClose={() => setOpenKey(null)} roster={state.roster} viewer={viewer}
        condition={state.team.condition} session={state.session} onAction={onAction} busy={busy}>
        {openTask && openTask.stage !== STAGES[STAGES.length - 1] && (m.help || m.chat) && (
          <div className="row wrap">
            {m.help && !myOpenHelp && <button className="btn" onClick={() => ui.askHelp(openTask.key)}><LifeBuoy size={16} />Нужна помощь с задачей</button>}
            {m.chat && <button className="btn ghost" onClick={() => ui.discuss(openTask.key)}><MessagesSquare size={16} />Обсудить в Эфире</button>}
          </div>
        )}
      </TaskSheet>
      <HelpModal open={helpFor !== undefined} taskKey={helpFor ?? null} onClose={() => setHelpFor(undefined)} />
      <KudosModal open={kudosTo !== undefined} to={kudosTo ?? null} onClose={() => setKudosTo(undefined)} />
    </WorkUiCtx.Provider>
  );
}

/* ------------------------------------------------------------------ полоса над доской */

function WorkStrip({ filter, setFilter }: { filter: BoardFilter; setFilter: (f: BoardFilter) => void }) {
  const { state, me, people } = usePlay();
  const s = state.session;
  const done = state.tasks.filter((t) => t.stage === STAGES[STAGES.length - 1]).length;
  const cond = state.team.condition;
  const pm = state.roster.find((p) => p.role_slug === "pm");
  const sprintEnd = s.work_started_at ? new Date(new Date(s.work_started_at).getTime() + s.current_sprint * s.sprint_minutes * 60_000).toISOString() : null;
  const next = state.milestones.find((x) => !x.closed_at && x.deadline);
  return (
    <div className="work-strip">
      <div className="me-chip" style={{ ["--c" as string]: personColor(me.color_slot) }}>
        <PersonTile person={me} size="lg" />
        <div className="stack xs" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{capitalize(me.role_title)}{me.orig_role_title && <ArrowRightLeft size={13} style={{ display: "inline", marginLeft: 6, verticalAlign: "-2px" }} />}</strong>
          <span className="tiny muted ellipsis">{me.home_stages.length ? `ваш этап — ${me.home_stages.join(", ")}` : "помогайте, где тонко"}</span>
        </div>
      </div>
      <div className="strip-stat">
        <span className="tiny muted">Сдано</span>
        <span className="row tight"><strong className="display" style={{ fontSize: 20 }}>{done}</strong><span className="muted small">из {state.tasks.length}</span></span>
      </div>
      {next && (
        <div className="strip-stat">
          <span className="tiny muted row tight"><Flag size={11} />{next.key} · {next.done}/{next.tasks}</span>
          <strong className="display" style={{ fontSize: 17 }}><Countdown to={next.deadline} serverNow={s.now} over={<span style={{ color: "var(--bad)" }}>срок прошёл</span>} /></strong>
        </div>
      )}
      {cond === "sprints" && sprintEnd && (
        <div className="strip-stat">
          <span className="tiny muted row tight"><CalendarRange size={11} />Спринт {s.current_sprint}</span>
          <strong className="display" style={{ fontSize: 17 }}><Countdown to={sprintEnd} serverNow={s.now} /></strong>
        </div>
      )}
      {cond === "kanban" && (
        <div className="strip-stat">
          <span className="tiny muted row tight"><Gauge size={11} />Лимит WIP</span>
          <strong className="display" style={{ fontSize: 17 }}>{s.wip_limit} <span className="small muted" style={{ fontFamily: "var(--font)" }}>на этап</span></strong>
        </div>
      )}
      {cond === "hierarchy" && pm && (
        <div className="strip-stat">
          <span className="tiny muted row tight"><Crown size={11} />Руководитель</span>
          <span className="row tight"><PersonTile person={people[pm.participant_id]} size="xs" /><strong className="small">{pm.participant_id === me.participant_id ? "вы" : shortName(pm)}</strong></span>
        </div>
      )}
      <div className="spacer" />
      <Segmented value={filter} onChange={setFilter}
        items={[{ key: "all", title: "Все" }, { key: "mine", title: "Мои" }, ...(me.home_stages.length ? [{ key: "home" as const, title: "Мой этап" }] : [])]} />
    </div>
  );
}

/* ------------------------------------------------------------------ быстрые действия */

function Quickbar({ myHelp, onHelp, onThanks }: { myHelp: boolean; onHelp: () => void; onThanks: () => void }) {
  const { state, act, busy } = usePlay();
  const m = state.mechanics;
  const [weather, setWeather] = useState(false);
  if (!m.help && !m.kudos && !m.weather) return null;
  const mine = state.weather?.mine ?? null;
  return (
    <div className="quickbar" role="toolbar" aria-label="Быстрые действия">
      {m.help && (
        <button className={`btn ${myHelp ? "danger" : ""}`} onClick={onHelp} disabled={busy}>
          <LifeBuoy size={17} />{myHelp ? "Закрыть просьбу" : "Нужна помощь"}
        </button>
      )}
      {m.kudos && <button className="btn" onClick={onThanks}><HeartHandshake size={17} /><span className="hide-xs">Спасибо</span></button>}
      {m.weather && (
        <div style={{ position: "relative" }}>
          <button className="btn" aria-expanded={weather} onClick={() => setWeather((x) => !x)} title="Погода — как вам сейчас">
            <WeatherIcon value={mine} size={18} /><span className="hide-xs">Погода</span>
          </button>
          <AnimatePresence>
            {weather && (
              <motion.div className="weather-pop" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
                <div className="row between" style={{ padding: "2px 4px 8px" }}>
                  <strong className="small">Как вам сейчас?</strong>
                  <button className="btn ghost icon xs" onClick={() => setWeather(false)} aria-label="Закрыть"><X size={14} /></button>
                </div>
                {[...state.scenario.weather].sort((a, b) => b.value - a.value).map((o) => (
                  <button key={o.id} className="weather-line" aria-pressed={mine === o.value} disabled={busy}
                    onClick={async () => { if (await act("/api/p/weather", { value: o.value })) setWeather(false); }}>
                    <WeatherIcon value={o.value} size={20} />
                    <span className="stack xs" style={{ gap: 0 }}><strong className="small">{o.title}</strong><span className="tiny muted">{o.hint}</span></span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

const HELP_NOTES = ["Не понимаю задачу", "Нужна вторая пара глаз", "Не успеваю", "Не хватает информации"];

function HelpModal({ open, taskKey, onClose }: { open: boolean; taskKey: string | null; onClose: () => void }) {
  const { state, me, act, busy } = usePlay();
  const [key, setKey] = useState<string>("");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setKey(taskKey ?? ""); setNote(""); } }, [open, taskKey]);
  const mineFirst = [...state.tasks.filter((t) => t.stage !== "Сдача")]
    .sort((a, b) => (b.assignee === me.participant_id ? 1 : 0) - (a.assignee === me.participant_id ? 1 : 0));
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack lg">
        <div className="row" style={{ gap: 14 }}>
          <span className="tile lg" style={{ ["--c" as string]: "var(--bad)" }}><LifeBuoy size={22} /></span>
          <div className="stack xs"><h2 style={{ fontSize: 22 }}>Нужна помощь</h2>
            <span className="small muted">Команда увидит просьбу на доске и во вкладке «Команда». Просить — это нормально.</span></div>
        </div>
        <div className="field"><label>С какой задачей</label>
          <Select label="С какой задачей" value={key || NOBODY} showHint
            options={[nobodyOption("Вообще, не про задачу", "просто нужна поддержка"), ...taskOptions(mineFirst, me.participant_id)]}
            onChange={(v) => setKey(v === NOBODY ? "" : v)} /></div>
        <div className="field"><label>Что случилось <span className="muted">(по желанию)</span></label>
          <div className="suggest" style={{ marginBottom: 4 }}>
            {HELP_NOTES.map((n) => <button key={n} type="button" className="pill-toggle" aria-pressed={note === n} onClick={() => setNote(note === n ? "" : n)}>{n}</button>)}
          </div>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Своими словами" /></div>
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn accent" disabled={busy} onClick={async () => {
            if (await act("/api/p/help", { case_key: key || null, note: note.trim() || null }, "Команда увидит вашу просьбу")) onClose();
          }}><LifeBuoy size={16} />Позвать на помощь</button>
        </div>
      </div>
    </Modal>
  );
}

function KudosModal({ open, to, onClose }: { open: boolean; to: string | null; onClose: () => void }) {
  const { state, me, act, busy } = usePlay();
  const toast = useToast();
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("help");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setWho(to); setNote(""); } }, [open, to]);
  const mates = state.roster.filter((p) => p.participant_id !== me.participant_id);
  const target = mates.find((p) => p.participant_id === who);
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack lg">
        <div className="row" style={{ gap: 14 }}>
          <span className="tile lg" style={{ ["--c" as string]: "var(--p5)" }}><HeartHandshake size={22} /></span>
          <div className="stack xs"><h2 style={{ fontSize: 22 }}>Сказать спасибо</h2>
            <span className="small muted">Благодарность увидит вся команда. Это лучшее топливо для работы вместе.</span></div>
        </div>
        <div className="stack sm">
          <span className="label">Кому</span>
          <div className="people-pick">
            {mates.map((p) => (
              <button key={p.participant_id} className="person-pick" aria-pressed={who === p.participant_id} onClick={() => setWho(p.participant_id)}
                style={{ ["--c" as string]: personColor(p.color_slot) }}>
                <PersonTile person={p} size="lg" />
                <span className="small strong ellipsis" style={{ maxWidth: "100%" }}>{shortName(p)}</span>
                <span className="tiny muted ellipsis" style={{ maxWidth: "100%" }}>{p.role_title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="stack sm">
          <span className="label">За что</span>
          <div className="pick-grid">
            {state.scenario.kudos.map((k) => (
              <button key={k.id} className="pick" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}><KudosIcon kind={k.id} size={17} />{k.title}</button>
            ))}
          </div>
        </div>
        <input className="input" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="Пару слов от себя (по желанию)" />
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn accent" disabled={busy || !who} onClick={async () => {
            if (await act("/api/p/kudos", { to: who, kind, note: note.trim() || null })) {
              toast(<>Спасибо отправлено{target ? ` — ${shortName(target)} увидит` : ""}</>, "ok", <KudosIcon kind={kind} size={18} />);
              onClose();
            }
          }}><HeartHandshake size={16} />Отправить</button>
        </div>
      </div>
    </Modal>
  );
}

