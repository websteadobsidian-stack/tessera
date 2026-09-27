import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, Hash, Send, VolumeX } from "lucide-react";
import { clock } from "../lib/format";
import { personColor, shortName } from "../lib/people";
import type { Message, Person, Task } from "../lib/types";
import { Empty, PersonTile } from "../ui/core";
import { usePlay } from "./context";
import { useWorkUi } from "./workui";

const QUICK = ["Беру!", "Кому помочь?", "Передал(а) дальше", "Что горит?", "Кто на контроле?"];

/** Эфир — текстовый канал команды. Сохраняется только метаданные (кто, кому, когда); текст можно стереть после сбора. */
export function AirPanel({ height }: { height?: string }) {
  const { state, me, people, act, busy } = usePlay();
  const { draft, setDraft, openTask } = useWorkUi();
  const messages = state.air;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const silence = !!state.session.silence_until;
  const tasksByKey = useMemo(() => Object.fromEntries(state.tasks.map((t) => [t.key, t])), [state.tasks]);
  const mates = state.roster.filter((p) => p.participant_id !== me.participant_id);

  // Прокрутка вниз при новых сообщениях.
  const last = messages[messages.length - 1]?.message_id;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  useEffect(() => {
    if (draft && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.length, draft.length);
      setCaret(draft.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Слово под курсором: @имя или #KEY — для подсказок.
  const token = useMemo(() => {
    const before = draft.slice(0, caret);
    const m = before.match(/(^|\s)([@#])([^\s@#]*)$/);
    return m ? { sigil: m[2], query: m[3].toLowerCase(), start: before.length - m[3].length - 1 } : null;
  }, [draft, caret]);

  const suggestions: { id: string; label: ReactNode; insert: string }[] = useMemo(() => {
    if (!token) return [];
    // Уже полностью набранное имя или ключ не подсказываем — тогда Enter сразу отправляет.
    if (token.sigil === "@") {
      if (mates.some((p) => handle(p).toLowerCase() === token.query)) return [];
      return mates.filter((p) => shortName(p).toLowerCase().startsWith(token.query) || p.role_title.toLowerCase().startsWith(token.query))
        .slice(0, 6).map((p) => ({ id: p.participant_id, label: <><PersonTile person={p} size="xs" />{shortName(p)}</>, insert: `@${handle(p)} ` }));
    }
    if (state.tasks.some((t) => t.key.toLowerCase() === token.query)) return [];
    return state.tasks.filter((t) => t.stage !== "Сдача" && t.key.toLowerCase().startsWith(token.query))
      .slice(0, 6).map((t) => ({ id: t.key, label: <><span className="mono">{t.key}</span><span className="ellipsis" style={{ maxWidth: 160 }}>{t.title}</span></>, insert: `#${t.key} ` }));
  }, [token, mates, state.tasks]);

  const insert = (text: string) => {
    if (!token) return;
    const next = draft.slice(0, token.start) + text + draft.slice(caret);
    setDraft(next);
    const pos = token.start + text.length;
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };

  const send = async (text = draft) => {
    const body = text.trim();
    if (!body) return;
    const mentions = mates.filter((p) => body.includes(`@${handle(p)}`)).map((p) => p.participant_id);
    const key = body.match(/#([A-ZА-Я]{1,3}-?\d{1,3})/i)?.[1]?.toUpperCase() ?? null;
    const ok = await act("/api/p/air", { body, mentions, case_key: key && tasksByKey[key] ? key : null });
    if (ok && text === draft) setDraft("");
  };

  const groups = useMemo(() => group(messages), [messages]);

  return (
    <div className="air-panel" style={height ? { height } : undefined}>
      {silence && (
        <div className="notice silence" style={{ marginBottom: 10 }}>
          <span className="ico"><VolumeX size={16} /></span>
          <div><div className="title">Тишина</div><div className="body">Говорить вслух нельзя — только Эфир. Самое время писать коротко и по делу.</div></div>
        </div>
      )}
      <div className="air-list" ref={listRef}>
        {messages.length === 0 ? (
          <Empty title="В Эфире тихо">Пишите сюда то, что важно не потерять: кто что берёт, что мешает. <br />@имя — позвать коллегу, #ключ — сослаться на задачу.</Empty>
        ) : (
          <AnimatePresence initial={false}>
            {groups.map((g) => {
              const who = people[g.participant_id];
              const mine = g.participant_id === me.participant_id;
              return (
                <motion.div key={g.items[0].message_id} className={`msg ${mine ? "mine" : ""}`} layout="position"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  {!mine && <PersonTile person={who} size="sm" />}
                  <div className="stack xs" style={{ alignItems: mine ? "flex-end" : "flex-start", minWidth: 0, maxWidth: "84%" }}>
                    {!mine && <span className="who" style={{ color: personColor(who?.color_slot) }}>{shortName(who)} <span className="muted" style={{ fontWeight: 500 }}>· {clock(g.items[0].sent_at)}</span></span>}
                    {g.items.map((m) => (
                      <div key={m.message_id} className={`bubble ${m.during_silence ? "silent" : ""} ${m.mentions.includes(me.participant_id) ? "ping" : ""}`}
                        title={m.during_silence ? "Отправлено во время тишины" : clock(m.sent_at)}>
                        {m.body === null ? <span className="muted">сообщение удалено</span> : <Rich text={m.body} people={state.roster} tasks={tasksByKey} onTask={openTask} />}
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
      <div className="composer-wrap">
        {suggestions.length > 0 ? (
          <div className="suggest-list" role="listbox">
            {suggestions.map((s, i) => (
              <button key={s.id} role="option" aria-selected={i === 0} className="suggest-row" onMouseDown={(e) => { e.preventDefault(); insert(s.insert); }}>
                {s.label}{i === 0 && <span className="kbd" style={{ marginLeft: "auto" }}>Enter</span>}
              </button>
            ))}
          </div>
        ) : !draft && (
          <div className="suggest">
            {QUICK.map((q) => <button key={q} className="chip lg outline" style={{ cursor: "pointer" }} disabled={busy} onClick={() => void send(q)}>{q}</button>)}
          </div>
        )}
        <div className="composer">
          <textarea ref={inputRef} className="textarea" rows={1} maxLength={500} value={draft} placeholder={silence ? "Тишина: пишите здесь…" : "Сообщение команде…"}
            onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (suggestions.length && token) insert(suggestions[0].insert);
                else void send();
              }
            }} />
          <button className="btn accent icon" aria-label="Отправить" disabled={busy || !draft.trim()} onClick={() => void send()}><Send size={17} /></button>
        </div>
        <div className="row tight tiny muted" style={{ paddingTop: 6 }}>
          <AtSign size={12} />позвать · <Hash size={12} />задача · Enter — отправить
        </div>
      </div>
    </div>
  );
}

/** Имя для упоминания — без пробелов. */
export function handle(p: Person) {
  return shortName(p).replace(/\s+/g, "_");
}

function group(messages: Message[]) {
  const out: { participant_id: string; items: Message[] }[] = [];
  for (const m of messages) {
    const g = out[out.length - 1];
    const prev = g?.items[g.items.length - 1];
    if (g && g.participant_id === m.participant_id && prev && new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() < 120_000) g.items.push(m);
    else out.push({ participant_id: m.participant_id, items: [m] });
  }
  return out;
}

/** Текст сообщения с подсветкой @упоминаний и кликабельными #задачами. */
export function Rich({ text, people, tasks, onTask }: { text: string; people: Person[]; tasks: Record<string, Task>; onTask?: (key: string) => void }) {
  const handles = new Map(people.map((p) => [handle(p).toLowerCase(), p]));
  const parts = text.split(/(@[^\s@#.,!?;:]+|#[A-Za-zА-Яа-я]{1,3}-?\d{1,3})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          const p = handles.get(part.slice(1).toLowerCase());
          if (p) return <span key={i} className="mention" style={{ color: personColor(p.color_slot) }}>{part}</span>;
        }
        if (part.startsWith("#")) {
          const key = part.slice(1).toUpperCase();
          if (tasks[key]) {
            return (
              <button key={i} className="task-ref" onClick={() => onTask?.(key)} title={tasks[key].title}>
                #{key}
              </button>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
