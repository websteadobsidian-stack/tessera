import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Handshake, Plus, ThumbsUp } from "lucide-react";
import { LANES } from "../lib/format";
import type { RetroState } from "../lib/types";
import { usePlay } from "./context";

const LANE_COLOR: Record<keyof typeof LANES, string> = { start: "var(--p3)", stop: "var(--p8)", continue: "var(--p1)" };

/** Ретро: начать / перестать / продолжить. Три голоса на человека; лучшее станет договорённостями на следующую сессию. */
export function Retro() {
  const { state } = usePlay();
  const r = state.retro;
  if (!r) return null;
  const top = [...r.cards].filter((c) => c.votes > 0).sort((a, b) => b.votes - a.votes || a.card_id - b.card_id).slice(0, 3);
  return (
    <main className="page stack xl">
      <div className="row between wrap top" style={{ gap: 20 }}>
        <div className="stack">
          <span className="eyebrow">Ретроспектива</span>
          <h1>Что меняем в следующий раз?</h1>
          <p className="soft" style={{ fontSize: 17, maxWidth: 640 }}>Пишите карточки в три колонки. Потом голосуйте — у каждого три голоса. Три лучших станут договорённостями команды: в следующий раз вы увидите их на брифинге, а в конце проверим, получилось ли.</p>
        </div>
        <div className="votes-left">
          <span className="dots">{[0, 1, 2].map((i) => <i key={i} className={i < r.votes_left ? "on" : ""} />)}</span>
          <span className="small soft">{r.votes_left > 0 ? `осталось голосов: ${r.votes_left}` : "все голоса отданы"}</span>
        </div>
      </div>
      <div className="lanes">
        {(Object.keys(LANES) as (keyof typeof LANES)[]).map((lane) => <Lane key={lane} lane={lane} retro={r} />)}
      </div>
      {top.length > 0 && (
        <div className="panel glow stack">
          <div className="panel-title"><Handshake size={18} /><h3>Станут договорённостями</h3></div>
          {top.map((c, i) => (
            <motion.div key={c.card_id} layout className="fact shared">
              <span className="bar-v" style={{ background: LANE_COLOR[c.lane] }} />
              <span className="grow"><span className="muted">{i + 1}. {LANES[c.lane].title}: </span>{c.body}</span>
              <span className="chip">{c.votes}</span>
            </motion.div>
          ))}
          <span className="tiny muted">Итог зафиксируется, когда ведущий перейдёт к выходному опросу.</span>
        </div>
      )}
    </main>
  );
}

function Lane({ lane, retro }: { lane: keyof typeof LANES; retro: RetroState }) {
  const { act, busy } = usePlay();
  const [text, setText] = useState("");
  // Порядок — по времени появления: пока голосуют, карточки не должны прыгать. Рейтинг — в блоке ниже.
  const cards = retro.cards.filter((c) => c.lane === lane).sort((a, b) => a.card_id - b.card_id);
  const add = async () => {
    if (!text.trim()) return;
    if (await act("/api/p/retro/cards", { lane, body: text.trim() })) setText("");
  };
  return (
    <section className="lane" style={{ ["--lane" as string]: LANE_COLOR[lane] }}>
      <div className="lane-head">
        <span className="swatch" style={{ background: LANE_COLOR[lane], width: 12, height: 12, borderRadius: 4 }} />
        <div className="stack xs"><h3>{LANES[lane].title}</h3><span className="tiny muted">{LANES[lane].hint}</span></div>
        <span className="n muted small" style={{ marginLeft: "auto" }}>{cards.length}</span>
      </div>
      <AnimatePresence initial={false}>
        {cards.map((c) => (
          <motion.div key={c.card_id} layout className={`sticky ${c.mine ? "mine" : ""}`}
            initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
            <span>{c.body}</span>
            <div className="row between">
              <span className="dots">{Array.from({ length: Math.min(c.votes, 8) }, (_, i) => <i key={i} className="on" />)}</span>
              <button className={`btn xs ${c.voted ? "accent" : ""}`} disabled={busy || (!c.voted && retro.votes_left <= 0)}
                onClick={() => act(`/api/p/retro/cards/${c.card_id}/vote`)} aria-pressed={c.voted}>
                <ThumbsUp size={12} />{c.voted ? "ваш голос" : "голос"}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="lane-add">
        <textarea className="textarea" rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={lane === "start" ? "Например: сразу выкладывать факты" : lane === "stop" ? "Например: держать задачи у себя молча" : "Например: благодарить друг друга"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void add(); } }} />
        <button className="btn sm" disabled={busy || !text.trim()} onClick={() => void add()}><Plus size={14} />Добавить</button>
      </div>
    </section>
  );
}
