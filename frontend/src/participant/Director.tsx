import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  ArrowRightLeft, Car, ChevronDown, Clapperboard, ExternalLink, Eye, Lightbulb, MonitorPlay, Radar, SkipForward, VolumeX, Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { TOKENS, api, store } from "../lib/api";
import { PHASES, phaseTitle } from "../lib/format";
import { useStored } from "../lib/hooks";
import { shortName } from "../lib/people";
import type { Catalog } from "../lib/types";
import { PersonTile, Segmented } from "../ui/core";
import { useAction } from "../ui/overlays";
import { usePlay } from "./context";

const SPEEDS = ["0.5", "1", "2", "4"] as const;

/** Режиссёр демо-песочницы: двигать этапы, запускать эксперименты, ускорять ботов и смотреть глазами любого участника. */
export function Director() {
  const { state, me, reload } = usePlay();
  const token = store.get(TOKENS.director);
  const [open, setOpen] = useStored<boolean>("tessera.director.open", window.innerWidth > 720);
  const [speed, setSpeed] = useStored<string>("tessera.director.speed", "1");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [nudge, setNudge] = useState("");
  const { run, busy } = useAction();
  const t = state.team.team_id, s = state.session.session_id;
  const base = `/api/admin/sessions/${t}/${s}`;

  useEffect(() => {
    if (token) api<Catalog>("/api/admin/catalog", { token }).then(setCatalog).catch(() => undefined);
  }, [token]);
  // На рабочем этапе доске нужно место: панель сворачивается в полоску (раскрыть — одним нажатием).
  const phase = state.session.phase;
  useEffect(() => { if (phase === "work") setOpen(false); }, [phase, setOpen]);
  if (!token) return null;

  const order = PHASES.map((p) => p.key).filter((p) => p !== "retro" || state.mechanics.retro);
  const idx = order.indexOf(state.session.phase);
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const working = state.session.phase === "work";

  const post = (path: string, body: unknown, ok?: string) =>
    run(async () => { await api(path, { method: "POST", token, body }); await reload(); }, ok);
  const fire = (kind: string, extra: Record<string, unknown> = {}, ok?: string) => post(`${base}/interventions`, { kind, ...extra }, ok);
  const possess = (pid: string) => run(async () => {
    const r = await api<{ participant_token: string }>("/api/demo/possess", { method: "POST", token, body: { participant_id: pid } });
    store.set(TOKENS.participant, r.participant_token);
    window.location.reload();
  });
  const changeSpeed = (v: string) => { setSpeed(v); void post("/api/demo/speed", { speed: Number(v) }, `Боты: ×${v}`); };
  const minutes = Math.max(0.5, Math.round(4 * state.session.time_scale * 2) / 2);

  return (
    <div className={`director ${open ? "open" : ""}`}>
      <div className="director-bar">
        <button className="director-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Свернуть" : "Развернуть панель режиссёра"}>
          <span className="tile sm" style={{ ["--c" as string]: "var(--accent-strong)" }}><Clapperboard size={13} /></span>
          <span className="stack xs grow" style={{ gap: 0, textAlign: "left", minWidth: 0 }}>
            <strong className="small">Режиссёр демо</strong>
            <span className="tiny muted ellipsis">{phaseTitle(state.session.phase)}{working && !open ? " · эксперименты внутри" : ""}</span>
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: "grid" }}><ChevronDown size={16} /></motion.span>
        </button>
        {!open && next && (
          <button className="btn accent sm" disabled={busy} title={`Дальше: ${phaseTitle(next)}`}
            onClick={() => post(`${base}/phase`, { phase: next }, `Этап: ${phaseTitle(next)}`)}>
            <SkipForward size={14} />Дальше
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="director-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="section">
              <span className="eyebrow">Этап</span>
              <button className="btn accent block" disabled={busy || !next} onClick={() => next && post(`${base}/phase`, { phase: next }, `Этап: ${phaseTitle(next)}`)}>
                <SkipForward size={16} />{next ? `Дальше: ${phaseTitle(next)}` : "Сессия завершена"}
              </button>
              {working && <span className="tiny muted">Работа закончится сама по таймеру — или переключите раньше.</span>}
            </div>

            {working && (
              <div className="section">
                <span className="eyebrow">Эксперименты</span>
                <div className="grid-btns">
                  {catalog?.injects.slice(0, 2).map((i) => (
                    <button key={i.key} className="btn sm" disabled={busy} title={i.hint} onClick={() => fire("inject", { key: i.key }, `Вброс: ${i.title}`)}>
                      <Zap size={14} /><span className="ellipsis">{i.title}</span>
                    </button>
                  ))}
                  {state.mechanics.probes && (
                    <button className="btn sm" disabled={busy} onClick={() => fire("probe", { key: catalog?.probes[Math.floor(Math.random() * (catalog?.probes.length ?? 1))]?.key ?? "priority" }, "Синхрон запущен")}>
                      <Radar size={14} />Синхрон
                    </button>
                  )}
                  <button className="btn sm" disabled={busy} onClick={() => fire("silence", { minutes }, "Тишина")}><VolumeX size={14} />Тишина</button>
                  <button className="btn sm" disabled={busy} onClick={() => fire("blind_spot", { target: "busiest", minutes }, "Выезд")}><Car size={14} />Выезд</button>
                  <button className="btn sm" disabled={busy} onClick={() => fire("role_swap", { minutes }, "Смена ролей")}><ArrowRightLeft size={14} />Смена ролей</button>
                </div>
                <div className="row tight">
                  <input className="input" style={{ height: 34, fontSize: 13 }} value={nudge} maxLength={300} onChange={(e) => setNudge(e.target.value)} placeholder="Подсказка команде…" />
                  <button className="btn sm icon" disabled={busy || !nudge.trim()} aria-label="Отправить подсказку"
                    onClick={async () => { if (await fire("nudge", { text: nudge.trim() }, "Подсказка отправлена")) setNudge(""); }}><Lightbulb size={14} /></button>
                </div>
              </div>
            )}

            <div className="section">
              <span className="eyebrow">Скорость ботов</span>
              <Segmented value={speed as (typeof SPEEDS)[number]} onChange={changeSpeed} items={SPEEDS.map((v) => ({ key: v, title: `×${v}` }))} />
            </div>

            <div className="section">
              <span className="eyebrow row tight"><Eye size={12} />Смотреть глазами</span>
              <div className="row wrap tight">
                {state.roster.map((p) => (
                  <button key={p.participant_id} className="btn ghost xs" style={{ padding: 2, height: "auto" }} disabled={busy || p.participant_id === me.participant_id}
                    title={p.participant_id === me.participant_id ? "Это вы" : `Стать: ${shortName(p)} · ${p.role_title}`} onClick={() => possess(p.participant_id)}>
                    <PersonTile person={p} size="sm" badge={p.participant_id === me.participant_id ? "•" : undefined} />
                  </button>
                ))}
              </div>
            </div>

            <div className="row tight">
              <Link className="btn sm grow" to={`/facilitator/session/${t}/${s}`} target="_blank"><ExternalLink size={14} />Пульт ведущего</Link>
              <Link className="btn sm grow" to={`/stage/${t}/${s}`} target="_blank"><MonitorPlay size={14} />Проектор</Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
