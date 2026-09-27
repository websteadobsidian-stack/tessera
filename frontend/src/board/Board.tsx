import { LayoutGroup, motion } from "motion/react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, CornerUpLeft, Flag, LifeBuoy, Play, UserRound, Zap } from "lucide-react";
import { BACKLOG, COLUMNS, STAGES, stageColor } from "../lib/format";
import { useSeen } from "../lib/hooks";
import { fullName, personColor, shortName } from "../lib/people";
import type { Condition, HelpRequest, Person, SessionInfo, Task } from "../lib/types";
import { PersonTile } from "../ui/core";
import { nobodyOption, NOBODY, personOptions, stageOptions } from "../ui/options";
import { Sheet } from "../ui/overlays";
import { Select } from "../ui/select";
import { permissions, quickAction, stageIndex, type OnAction, type Viewer } from "./permissions";

const PRIORITY: Record<Task["priority"], { label: string; cls: string } | null> = {
  normal: null,
  high: { label: "важно", cls: "warn" },
  urgent: { label: "срочно", cls: "bad" },
};

export type BoardFilter = "all" | "mine" | "home";

interface BoardProps {
  tasks: Task[];
  roster: Person[];
  condition: Condition;
  session: SessionInfo;
  viewer?: Viewer | null;
  homeStages?: string[];
  meSlot?: number;
  filter?: BoardFilter;
  help?: HelpRequest[];
  onAction?: OnAction;
  onOpen?: (key: string) => void;
  busy?: boolean;
}

export function Board({ tasks, roster, condition, session, viewer, homeStages = [], meSlot, filter = "all", help = [], onAction, onOpen, busy }: BoardProps) {
  const people = useMemo(() => Object.fromEntries(roster.map((p) => [p.participant_id, p])), [roster]);
  const byColumn = useMemo(() => {
    const m: Record<string, Task[]> = Object.fromEntries(COLUMNS.map((c) => [c, []]));
    for (const t of tasks) (m[t.stage] ??= []).push(t);
    // В бэклоге спринта запланированные задачи — сверху.
    m[BACKLOG].sort((a, b) => (a.sprint === null ? 1 : 0) - (b.sprint === null ? 1 : 0));
    return m;
  }, [tasks]);
  const openHelp = useMemo(() => {
    const out: Record<string, HelpRequest> = {};
    for (const h of help) if (!h.resolved_at && h.case_key) out[h.case_key] = h;
    return out;
  }, [help]);
  const fresh = useSeen(tasks.map((t) => t.key));
  const kanban = condition === "kanban";

  const dim = (t: Task) =>
    (filter === "mine" && t.assignee !== viewer?.participant_id) ||
    (filter === "home" && !homeStages.includes(t.stage));

  return (
    <LayoutGroup>
      <motion.div layoutScroll className="board" role="list" aria-label="Доска задач" style={{ ["--me" as string]: personColor(meSlot) }}>
        {COLUMNS.map((col) => {
          const items = byColumn[col] ?? [];
          const limited = kanban && col !== BACKLOG && col !== STAGES[STAGES.length - 1];
          const full = limited && items.length >= session.wip_limit;
          const home = homeStages.includes(col);
          return (
            <section key={col} className={`column ${home ? "home" : ""} ${full ? "full" : ""}`} aria-label={col} style={{ ["--sc" as string]: stageColor(col) }}>
              {home && <span className="home-pill">ваш этап</span>}
              {limited && <WipGauge n={items.length} limit={session.wip_limit} />}
              <div className="column-head">
                <span className="col-count" style={{ ["--sc" as string]: stageColor(col) }}>{items.length}</span>
                <span className="name ellipsis" title={col}>{col}</span>
              </div>
              {items.map((t) => (
                <TaskCard key={t.key} task={t} people={people} viewer={viewer} condition={condition} session={session}
                  help={openHelp[t.key]} dimmed={dim(t)} fresh={fresh.has(t.key)}
                  onOpen={onOpen ? () => onOpen(t.key) : undefined} onAction={onAction} busy={busy} />
              ))}
              {items.length === 0 && (
                <div className="column-empty">
                  <span className="ghost-tiles" aria-hidden><i /><i /><i /></span>
                  {col === STAGES[STAGES.length - 1] ? "Здесь соберутся сданные задачи" : col === BACKLOG ? "Бэклог разобран" : "Пока пусто"}
                </div>
              )}
            </section>
          );
        })}
      </motion.div>
    </LayoutGroup>
  );
}

/** Лимит WIP как ряд ячеек: занятые — закрашены. При большом лимите — числом. */
function WipGauge({ n, limit }: { n: number; limit: number }) {
  const full = n >= limit;
  return (
    <span className={`wip ${full ? "full" : ""}`} title={`Лимит незавершённой работы: ${n} из ${limit}`}>
      {limit <= 6 ? Array.from({ length: limit }, (_, i) => <i key={i} className={i < n ? "on" : ""} />) : <b>{n}/{limit}</b>}
    </span>
  );
}

function TaskCard({ task: t, people, viewer, condition, session, help, dimmed, fresh, onOpen, onAction, busy }: {
  task: Task; people: Record<string, Person>; viewer?: Viewer | null; condition: Condition; session: SessionInfo;
  help?: HelpRequest; dimmed: boolean; fresh: boolean; onOpen?: () => void; onAction?: OnAction; busy?: boolean;
}) {
  const perm = permissions(t, viewer, condition, session);
  const quick = onAction ? quickAction(t, perm) : null;
  const who = t.assignee ? people[t.assignee] : null;
  const mine = !!viewer && t.assignee === viewer.participant_id;
  const pr = PRIORITY[t.priority];
  const done = t.stage === STAGES[STAGES.length - 1];
  const idx = stageIndex(t.stage);
  const cls = ["task", mine && "mine", t.started && "working", t.priority === "urgent" && !done && "urgent",
    who?.away_until && "owner-away", done && "done"].filter(Boolean).join(" ");
  const opacity = dimmed ? 0.32 : who?.away_until ? 0.72 : 1;
  const style: CSSProperties = { ["--who" as string]: personColor(who?.color_slot), opacity };

  return (
    <motion.div layout="position" layoutId={`task-${t.key}`} role="listitem" tabIndex={0} className={cls} style={style}
      initial={fresh ? { opacity: 0, scale: 0.85, y: -8 } : false} animate={{ opacity, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 520, damping: 42 }}
      onClick={onOpen} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && onOpen) { e.preventDefault(); onOpen(); } }}>
      {help && (
        <span className="help-flag chip bad" title={`Нужна помощь${help.note ? `: ${help.note}` : ""}`}>
          <LifeBuoy size={12} />{help.helper_id ? "помогают" : "SOS"}
        </span>
      )}
      <div className="t-meta">
        <span className="key">{t.key}</span>
        <span className="ellipsis">{t.project}</span>
        {pr && !done && <span className={`chip ${pr.cls}`}>{pr.label}</span>}
        {t.injected && <span className="chip warn" title="Появилась из вброса"><Zap size={11} /></span>}
        {t.sprint !== null && t.stage === BACKLOG && <span className="chip accent">спринт {t.sprint}</span>}
        {t.milestone && !done && <span className="ms">{t.milestone}</span>}
      </div>
      <div className="t-title">{t.title}</div>
      <div className="path" aria-hidden>
        {STAGES.map((s, i) => <span key={s} style={i <= idx ? { background: stageColor(s) } : undefined} />)}
      </div>
      <div className="t-foot">
        {t.stage === BACKLOG && quick ? <span /> : <TaskState task={t} />}
        <div className="row tight">
          {quick && (
            <button className="btn xs primary" disabled={busy}
              onClick={(e) => { e.stopPropagation(); void onAction?.(t.key, quick.action, quick.body); }}>
              {quick.label}{quick.action !== "sprint" && <ArrowRight size={13} />}
            </button>
          )}
          {who && <PersonTile person={who} size="sm" title={fullName(who)} />}
        </div>
      </div>
    </motion.div>
  );
}

function TaskState({ task: t }: { task: Task }) {
  if (t.stage === STAGES[STAGES.length - 1]) return <span className="state done"><i />сдана</span>;
  if (t.stage === BACKLOG) return <span className="state">в очереди</span>;
  return <span className={`state ${t.started ? "working" : "waiting"}`}><i />{t.started ? "в работе" : "ждёт"}</span>;
}

/* ------------------------------------------------------------------ карточка задачи */

export function TaskSheet({ task: t, open, onClose, roster, viewer, condition, session, onAction, busy, children }: {
  task: Task | null; open: boolean; onClose: () => void; roster: Person[]; viewer?: Viewer | null; condition: Condition;
  session: SessionInfo; onAction?: OnAction; busy?: boolean; children?: ReactNode;
}) {
  return (
    <Sheet open={open && !!t} onClose={onClose} title={t?.title ?? ""}
      subtitle={t && (
        <div className="row wrap tight">
          <span className="mono tiny muted">{t.key}</span>
          <span className="chip"><span className="swatch" style={{ background: stageColor(t.stage) }} />{t.stage}</span>
          <span className="chip outline">{t.project}</span>
          {t.milestone && <span className="chip outline"><Flag size={11} />{t.milestone}</span>}
          {PRIORITY[t.priority] && <span className={`chip ${PRIORITY[t.priority]!.cls}`}>{PRIORITY[t.priority]!.label}</span>}
          {t.injected && <span className="chip warn"><Zap size={11} />из вброса</span>}
        </div>
      )}>
      {t && <TaskSheetBody key={`${t.key}-${t.stage}`} task={t} roster={roster} viewer={viewer} condition={condition} session={session}
        onAction={onAction} busy={busy}>{children}</TaskSheetBody>}
    </Sheet>
  );
}

function TaskSheetBody({ task: t, roster, viewer, condition, session, onAction, busy, children }: {
  task: Task; roster: Person[]; viewer?: Viewer | null; condition: Condition; session: SessionInfo;
  onAction?: OnAction; busy?: boolean; children?: ReactNode;
}) {
  const perm = onAction ? permissions(t, viewer, condition, session) : null;
  const idx = stageIndex(t.stage);
  const earlier = idx > 0 ? STAGES.slice(0, idx) : [];
  const [target, setTarget] = useState<string>(earlier[earlier.length - 1] ?? "");
  const act = (a: Parameters<OnAction>[1], body?: Record<string, unknown>) => void onAction?.(t.key, a, body);
  const who = roster.find((p) => p.participant_id === t.assignee) ?? null;
  const none = perm && !perm.pull && !perm.start && !perm.advance && !perm.ret && !perm.assign && !perm.sprint;

  return (
    <>
      <p className="soft" style={{ fontSize: 15 }}>{t.description || "Без описания."}</p>

      <div className="stack sm">
        <span className="eyebrow">Путь задачи</span>
        <div className="stage-path">
          {STAGES.map((s, i) => (
            <div key={s} className={`sp ${i < idx ? "past" : i === idx ? "now" : ""}`} style={{ ["--sc" as string]: stageColor(s) }}>
              <span className="bar" />
              <span className="name">{s}</span>
            </div>
          ))}
        </div>
        {t.stage === BACKLOG && <span className="tiny muted">Задача ещё в бэклоге{t.sprint !== null ? ` · запланирована в спринт ${t.sprint}` : ""}.</span>}
      </div>

      <div className="stack sm">
        <span className="eyebrow">Исполнитель</span>
        {who ? (
          <div className="row">
            <PersonTile person={who} size="lg" online={who.online} />
            <div className="stack xs grow">
              <strong>{shortName(who)}{viewer?.participant_id === who.participant_id && <span className="muted"> · вы</span>}</strong>
              <span className="small muted">{who.role_title}{t.started ? " · в работе" : " · ещё не начал(а)"}</span>
            </div>
          </div>
        ) : <span className="row tight muted"><UserRound size={16} />Никто не взял</span>}
        {perm?.assign && (
          <Select label="Назначить исполнителя" value={t.assignee ?? NOBODY} disabled={busy} showHint
            options={[nobodyOption("Не назначен", "задачу возьмёт тот, кто освободится"), ...personOptions(roster, viewer?.participant_id)]}
            onChange={(v) => act("assign", { assignee: v === NOBODY ? null : v })} />
        )}
      </div>

      {perm && (
        <div className="stack">
          <span className="eyebrow">Действия</span>
          {perm.sprint && (
            <button className="btn" disabled={busy} onClick={() => act("sprint", { add: t.sprint === null })}>
              {t.sprint === null ? `Запланировать в спринт ${session.current_sprint}` : "Убрать из спринта"}
            </button>
          )}
          {perm.pull && <button className="btn primary lg" disabled={busy} onClick={() => act("pull")}>Взять из бэклога в анализ <ArrowRight size={18} /></button>}
          {perm.start && (
            <button className={`btn lg ${perm.takeover ? "" : "primary"}`} disabled={busy} onClick={() => act("start")}>
              <Play size={17} />{perm.takeover ? `Перехватить у ${shortName(who)}` : "Взять в работу"}
            </button>
          )}
          {perm.advance && (
            <button className="btn primary lg" disabled={busy} onClick={() => act("advance")}>
              {t.stage === "Контроль" ? "Принять и сдать" : `Передать на «${STAGES[idx + 1]}»`} <ArrowRight size={18} />
            </button>
          )}
          {perm.ret && earlier.length > 0 && (
            <div className="row">
              <Select label="Вернуть на этап" value={target} options={stageOptions(earlier)} onChange={setTarget} style={{ flex: 1 }} />
              <button className="btn danger" disabled={busy} onClick={() => act("return", { to: target })}>
                <CornerUpLeft size={16} />Вернуть
              </button>
            </div>
          )}
          {none && <p className="small muted">Сейчас у вас нет действий с этой задачей{condition === "hierarchy" ? " — в иерархии задачи распределяет руководитель" : ""}.</p>}
        </div>
      )}
      {viewer?.away && <p className="small" style={{ color: "var(--warn)" }}>Вы на выезде у клиента — действия с задачами недоступны.</p>}
      {children}
    </>
  );
}
