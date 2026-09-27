import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft, Bell, Car, Check, Lightbulb, MapPin, Radar, Star, VolumeX, X, Zap, type LucideIcon,
} from "lucide-react";
import { pct } from "../lib/format";
import { useStored } from "../lib/hooks";
import type { Notice, ProbeLast, ProbeOpen } from "../lib/types";
import { Ring } from "../ui/core";
import { TileBurst } from "../ui/effects";
import { Countdown, useLeft } from "./Timer";
import { usePlay } from "./context";

export const NOTICE_ICONS: Record<string, LucideIcon> = {
  inject: Zap,
  nudge: Lightbulb,
  achievement: Star,
  silence: VolumeX,
  blind_spot: Car,
  blind_spot_self: MapPin,
  role_swap: ArrowRightLeft,
  role_swap_self: ArrowRightLeft,
};

/** Всё, что «прилетает» поверх экрана: вбросы, подсказки, достижения, Синхрон, тишина, выезд, смена ролей. */
export function Overlays() {
  const { state } = usePlay();
  const working = state.session.phase === "work";
  return (
    <>
      <NoticeCards />
      {working && state.mechanics.probes && state.probe && <Probe open={state.probe.open} last={state.probe.last} />}
      {working && <Away />}
    </>
  );
}

/* ------------------------------------------------------------------ полосы: тишина, смена роли */

/** Полосы под верхней панелью: тишина и смена роли. Стоят в потоке сразу после шапки и прилипают к ней. */
export function Banners() {
  const { state, me } = usePlay();
  const s = state.session;
  if (s.phase !== "work") return null;
  return (
    <AnimatePresence>
      {s.silence_until && (
        <motion.div key="silence" className="banner" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
          <VolumeX size={16} />Тишина: говорить вслух нельзя — только Эфир
          <span className="chip" style={{ background: "rgba(0,0,0,.22)", color: "#fff", border: 0 }}><Countdown to={s.silence_until} serverNow={s.now} /></span>
        </motion.div>
      )}
      {me.swap_until && me.orig_role_title && (
        <motion.div key="swap" className="banner swap" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
          <ArrowRightLeft size={16} />Вы сейчас — {me.role_title} (вместо «{me.orig_role_title}»)
          <span className="chip" style={{ background: "rgba(0,0,0,.22)", color: "#fff", border: 0 }}><Countdown to={me.swap_until} serverNow={s.now} /></span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ карточки событий */

const HIDDEN_KINDS = new Set(["blind_spot_self"]);
// Что важнее увидеть сразу: вмешательства меняют правила прямо сейчас, достижения подождут.
const PRIORITY: Record<string, number> = { role_swap_self: 0, silence: 1, blind_spot: 1, role_swap: 1, inject: 2, nudge: 3, achievement: 4 };

function NoticeCards() {
  const { state, me } = usePlay();
  const key = `tessera.notice.${me.participant_id}`;
  const [seen, setSeen] = useStored<number | null>(key, null);
  const [queue, setQueue] = useState<Notice[]>([]);
  const [burst, setBurst] = useState(0);
  const maxId = state.notices.reduce((m, n) => Math.max(m, n.notice_id), 0);

  useEffect(() => {
    if (seen === null) { setSeen(maxId); return; } // первый вход: старое не показываем
    const fresh = state.notices.filter((n) => n.notice_id > seen && !HIDDEN_KINDS.has(n.kind));
    if (maxId > seen) setSeen(maxId);
    if (fresh.length) {
      setQueue((q) => {
        const [head, ...rest] = q;
        const pending = [...rest, ...fresh.filter((f) => !q.some((x) => x.notice_id === f.notice_id))]
          .sort((a, b) => (PRIORITY[a.kind] ?? 5) - (PRIORITY[b.kind] ?? 5) || a.notice_id - b.notice_id);
        return head ? [head, ...pending] : pending;
      });
      if (fresh.some((n) => n.kind === "achievement")) setBurst(Date.now());
    }
  }, [maxId, seen, setSeen, state.notices]);

  const current = queue[0];
  // Время показа считается от появления карточки: новые события в очереди его не продлевают.
  const backlog = useRef(queue.length);
  backlog.current = queue.length;
  useEffect(() => {
    if (!current) return;
    const base = current.kind === "inject" ? 10000 : current.kind === "achievement" ? 5500 : 7500;
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), backlog.current > 2 ? Math.min(base, 4000) : base);
    return () => window.clearTimeout(t);
  }, [current]);

  const Icon = current ? NOTICE_ICONS[current.kind] ?? Bell : Bell;
  return (
    <>
      <TileBurst trigger={burst} count={56} />
      <AnimatePresence mode="wait">
        {current && (
          <motion.div key={current.notice_id} className={`inject-card ${current.kind.replace("_self", "")}`} role="alert"
            initial={{ opacity: 0, y: -30, x: "-50%", scale: 0.94 }} animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: -16, x: "-50%", scale: 0.97 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={() => setQueue((q) => q.slice(1))}>
            <span className="ico"><Icon size={22} /></span>
            <div className="stack xs grow">
              <span className="eyebrow">{EYEBROW[current.kind] ?? "Событие"}</span>
              <strong style={{ fontSize: 17 }}>{current.title}</strong>
              {current.body && <span className="soft" style={{ fontSize: 14.5 }}>{current.body}</span>}
              {queue.length > 1 && <span className="tiny muted">ещё {queue.length - 1}</span>}
            </div>
            <button className="btn ghost icon sm" aria-label="Закрыть" onClick={(e) => { e.stopPropagation(); setQueue((q) => q.slice(1)); }}><X size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const EYEBROW: Record<string, string> = {
  inject: "Вброс · новости от клиента",
  nudge: "Подсказка",
  achievement: "Достижение команды",
  silence: "Эксперимент",
  blind_spot: "Эксперимент",
  role_swap: "Эксперимент",
  role_swap_self: "Эксперимент · ваша роль",
};

/* ------------------------------------------------------------------ Синхрон */

function Probe({ open, last }: { open: ProbeOpen | null; last: ProbeLast | null }) {
  const [skipped, setSkipped] = useStored<number[]>("tessera.probe.skipped", []);
  const [shown, setShown] = useStored<number[]>("tessera.probe.shown", []);
  const ask = open && !open.my_answer && !skipped.includes(open.probe_id) ? open : null;
  const result = !open && last && !shown.includes(last.probe_id) ? last : null;
  return (
    <>
      <AnimatePresence>
        {ask && <ProbeAsk key={ask.probe_id} probe={ask} onSkip={() => setSkipped((s) => [...s.slice(-20), ask.probe_id])} />}
      </AnimatePresence>
      <AnimatePresence>
        {open && !ask && <ProbeWaiting key={`w${open.probe_id}`} probe={open} />}
      </AnimatePresence>
      <AnimatePresence>
        {result && <ProbeResult key={`r${result.probe_id}`} probe={result} onClose={() => setShown((s) => [...s.slice(-20), result.probe_id])} />}
      </AnimatePresence>
    </>
  );
}

function ProbeAsk({ probe, onSkip }: { probe: ProbeOpen; onSkip: () => void }) {
  const { state, act, busy } = usePlay();
  const left = useLeft(probe.closes_at, state.session.now) ?? 0;
  const total = 45_000;
  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ zIndex: 71 }} />
      <motion.div className="probe-card panel solid glow" role="dialog" aria-modal="true"
        initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-40%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
        exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
        <div className="stack lg" style={{ padding: 8 }}>
          <div className="row between">
            <span className="eyebrow row tight" style={{ color: "var(--accent)" }}><Radar size={13} />Синхрон · отвечает вся команда</span>
            <Ring value={Math.max(0, left) / total} size={40} stroke={4}>{Math.max(0, Math.ceil(left / 1000))}</Ring>
          </div>
          <h2 style={{ fontSize: 24 }}>{probe.question}</h2>
          <div className="stack sm">
            {probe.options.map((o) => (
              <button key={o.id} className="option-card" disabled={busy}
                onClick={() => act(`/api/p/probe/${probe.probe_id}`, { answer: o.id })}>
                <span className="grow" style={{ fontWeight: 600 }}>{o.title}</span>
              </button>
            ))}
          </div>
          <div className="row between">
            <span className="tiny muted">Ответы не подписаны — команда увидит только, насколько вы совпали.</span>
            <button className="btn ghost sm" onClick={onSkip}>Пропустить</button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function ProbeWaiting({ probe }: { probe: ProbeOpen }) {
  const { state } = usePlay();
  return (
    <motion.div className="probe-pill" initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 20, x: "-50%" }}>
      <Radar size={15} color="var(--accent)" />
      <span className="small">Синхрон: ответили <strong>{probe.answered}</strong> из {probe.team_size}</span>
      <span className="chip"><Countdown to={probe.closes_at} serverNow={state.session.now} /></span>
    </motion.div>
  );
}

function ProbeResult({ probe, onClose }: { probe: ProbeLast; onClose: () => void }) {
  const total = Math.max(1, probe.answered);
  const opts = probe.options;
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const t = window.setTimeout(() => ref.current(), 24_000);
    return () => window.clearTimeout(t);
  }, []);
  const verdict = useMemo(() => {
    if (probe.answered === 0) return "Никто не успел ответить.";
    if (probe.alignment === 1 && probe.answered > 1) return "Полный синхрон — вы видите одно и то же.";
    if ((probe.alignment ?? 0) >= 0.66) return "Большинство видит одинаково.";
    return "Команда видит по-разному. Это повод сверить картину вслух.";
  }, [probe]);
  const truth = probe.truth ? opts.find((o) => o.id === probe.truth) : null;
  return (
    <motion.div className="probe-result panel solid" role="status"
      initial={{ opacity: 0, y: 40, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 30, x: "-50%" }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}>
      <div className="row between top">
        <div className="stack xs">
          <span className="eyebrow row tight" style={{ color: "var(--accent)" }}><Radar size={13} />Итоги Синхрона</span>
          <strong style={{ fontSize: 16 }}>{probe.question}</strong>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Закрыть"><X size={16} /></button>
      </div>
      <div className="stack sm">
        {opts.filter((o) => probe.counts[o.id] || o.id === probe.truth || o.id === probe.my_answer).map((o) => {
          const n = probe.counts[o.id] ?? 0;
          const isTruth = o.id === probe.truth;
          return (
            <div key={o.id} className="probe-bar">
              <div className="row between small">
                <span className="row tight">{o.title}{o.id === probe.my_answer && <span className="chip accent">вы</span>}{isTruth && <span className="chip good"><Check size={11} />так и есть</span>}</span>
                <span className="muted">{n}</span>
              </div>
              <div className="bar"><motion.span initial={{ width: 0 }} animate={{ width: `${(n / total) * 100}%` }}
                transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} style={{ background: isTruth ? "var(--good)" : "var(--accent)" }} /></div>
            </div>
          );
        })}
      </div>
      <div className="row between wrap">
        <span className="small soft">{verdict}</span>
        <span className="row tight small">
          {probe.alignment !== null && <span className="chip">совпадение {pct(probe.alignment)}</span>}
          {probe.accuracy !== null && truth && <span className="chip good">угадали {pct(probe.accuracy)}</span>}
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ выезд к клиенту */

function Away() {
  const { state, me } = usePlay();
  const [min, setMin] = useState(false);
  const until = me.away_until;
  useEffect(() => { if (until) setMin(false); }, [until]);
  if (!until) return null;
  if (min) {
    return (
      <div className="banner away-banner">
        <MapPin size={16} />Вы у клиента — действия с задачами недоступны · <Countdown to={until} serverNow={state.session.now} />
        <button className="btn xs" style={{ color: "#fff", borderColor: "rgba(255,255,255,.4)", background: "transparent" }} onClick={() => setMin(false)}>Развернуть</button>
      </div>
    );
  }
  return (
    <motion.div className="away-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div className="stack xl" style={{ maxWidth: 520, textAlign: "center", alignItems: "center" }}
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
        <motion.span className="tile xxl" style={{ ["--c" as string]: "var(--accent-strong)" }}
          animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
          <Car size={48} />
        </motion.span>
        <div className="stack">
          <span className="eyebrow" style={{ color: "#fff", opacity: 0.8 }}>Эксперимент «Выезд»</span>
          <h1 style={{ color: "#fff" }}>Вы у клиента</h1>
          <p style={{ color: "rgba(255,255,255,.85)", fontSize: 17 }}>
            Команда работает без вас. Не подсказывайте и не смотрите в чужие экраны — вернётесь и узнаете, что изменилось.
          </p>
        </div>
        <span className="display" style={{ fontSize: 64, fontWeight: 600, color: "#fff", letterSpacing: "-0.05em" }}>
          <Countdown to={until} serverNow={state.session.now} />
        </span>
        <button className="btn" style={{ color: "#fff", borderColor: "rgba(255,255,255,.35)", background: "rgba(255,255,255,.08)" }} onClick={() => setMin(true)}>
          Смотреть доску, пока жду
        </button>
      </motion.div>
    </motion.div>
  );
}

