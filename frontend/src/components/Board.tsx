import { useMemo, useState } from "react";
import { BACKLOG, COLUMNS, STAGES, initials, personLabel, stageColor } from "../format";
import type { Condition, Person, SessionInfo, Task } from "../types";
import { Avatar, Drawer, Icon } from "./ui";

export type TaskAction = "pull" | "start" | "advance" | "return" | "assign" | "sprint";
export type OnAction = (key: string, action: TaskAction, body?: Record<string, unknown>) => Promise<boolean>;

interface Viewer {
  participant_id: string;
  is_pm: boolean;
}

interface Props {
  tasks: Task[];
  roster: Person[];
  condition: Condition;
  session: SessionInfo;
  viewer?: Viewer | null; // null — режим наблюдения (ведущий)
  onAction?: OnAction;
  busy?: boolean;
}

function permissions(t: Task, v: Viewer | null | undefined, condition: Condition, session: SessionInfo) {
  if (!v || session.phase !== "work") return null;
  const hier = condition === "hierarchy";
  const mine = t.assignee === v.participant_id;
  const boss = hier && v.is_pm;
  const inFlow = (STAGES as readonly string[]).includes(t.stage) && t.stage !== "Сдача";
  return {
    pull: t.stage === BACKLOG && (!hier || v.is_pm) &&
      (condition !== "sprints" || (t.sprint !== null && t.sprint <= session.current_sprint)),
    start: inFlow && !t.started && (hier ? mine || (v.is_pm && !t.assignee) : true),
    advance: inFlow && t.started && (mine || boss),
    ret: ["Проектирование", "Исполнение", "Контроль"].includes(t.stage) &&
      (!t.assignee || mine || boss) && (!hier || mine || v.is_pm),
    assign: t.stage !== "Сдача" && (!hier || v.is_pm),
    sprint: condition === "sprints" && t.stage === BACKLOG,
  };
}

const PRIORITY: Record<Task["priority"], { label: string; cls: string } | null> = {
  normal: null,
  high: { label: "важно", cls: "warn" },
  urgent: { label: "срочно", cls: "bad" },
};

export function Board({ tasks, roster, condition, session, viewer, onAction, busy }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const people = useMemo(() => Object.fromEntries(roster.map((p) => [p.participant_id, p])), [roster]);
  const byColumn = useMemo(() => {
    const m: Record<string, Task[]> = Object.fromEntries(COLUMNS.map((c) => [c, []]));
    for (const t of tasks) (m[t.stage] ??= []).push(t);
    return m;
  }, [tasks]);
  const task = tasks.find((t) => t.key === open) ?? null;
  const kanban = condition === "kanban";

  return (
    <>
      <div className="board" role="list" aria-label="Доска задач">
        {COLUMNS.map((col) => {
          const items = byColumn[col] ?? [];
          const limited = kanban && col !== BACKLOG && col !== "Сдача";
          const full = limited && items.length >= session.wip_limit;
          return (
            <section key={col} className={`column ${full ? "full" : ""}`} aria-label={col}>
              <div className="stage-bar" style={{ background: stageColor(col) }} />
              <div className="column-head">
                <span className="name">{col}</span>
                <span className="n">{items.length}</span>
                {limited && (
                  <span className={`chip limit ${full ? "warn" : "outline"}`} title="Лимит незавершённой работы">
                    WIP {items.length}/{session.wip_limit}
                  </span>
                )}
              </div>
              {items.map((t) => (
                <TaskCard key={t.key} task={t} people={people} viewer={viewer} condition={condition}
                  session={session} onOpen={() => setOpen(t.key)} onAction={onAction} busy={busy} />
              ))}
              {items.length === 0 && <div className="tiny muted" style={{ padding: "8px 6px" }}>Пусто</div>}
            </section>
          );
        })}
      </div>
      {task && (
        <TaskDrawer task={task} people={people} roster={roster} viewer={viewer} condition={condition}
          session={session} onAction={onAction} busy={busy} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function TaskCard({ task: t, people, viewer, condition, session, onOpen, onAction, busy }: {
  task: Task; people: Record<string, Person>; viewer?: Viewer | null; condition: Condition; session: SessionInfo;
  onOpen: () => void; onAction?: OnAction; busy?: boolean;
}) {
  const perm = permissions(t, viewer, condition, session);
  const who = t.assignee ? people[t.assignee] : null;
  const mine = !!viewer && t.assignee === viewer.participant_id;
  const pr = PRIORITY[t.priority];
  const quick: { label: string; action: TaskAction; icon?: string } | null = !perm ? null
    : perm.pull ? { label: "В анализ", action: "pull", icon: "arrow" }
    : perm.advance ? { label: t.stage === "Контроль" ? "Сдать" : "Дальше", action: "advance", icon: "arrow" }
    : perm.start ? { label: "Взять", action: "start", icon: "play" }
    : perm.sprint && t.sprint === null ? { label: "В спринт", action: "sprint" }
    : null;

  return (
    <div role="listitem" tabIndex={0} className={`task ${mine ? "mine" : ""} ${t.started ? "active" : ""}`}
      style={{ ["--stage-color" as string]: stageColor(t.stage) }}
      onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}>
      <div className="t-meta">
        <span className="key">{t.key}</span>
        <span>{t.project}</span>
        {pr && <span className={`chip ${pr.cls}`}><Icon name="alert" size={12} />{pr.label}</span>}
        {t.sprint !== null && t.stage === BACKLOG && <span className="chip accent">спринт {t.sprint}</span>}
      </div>
      <div className="t-title">{t.title}</div>
      <div className="t-foot">
        {t.stage === "Сдача" ? (
          <span className="status-dot">сдана</span>
        ) : t.stage === BACKLOG ? (
          <span className="tiny muted">{t.milestone ?? ""}</span>
        ) : (
          <span className={`status-dot ${t.started ? "working" : "waiting"}`}>{t.started ? "в работе" : "ждёт"}</span>
        )}
        <div className="row" style={{ gap: 6 }}>
          {quick && onAction && (
            <button className="btn sm primary" disabled={busy}
              onClick={(e) => { e.stopPropagation(); onAction(t.key, quick.action, quick.action === "sprint" ? { add: true } : undefined); }}>
              {quick.label}{quick.icon && <Icon name={quick.icon} size={14} />}
            </button>
          )}
          {who && <Avatar text={initials(who)} me={mine} title={personLabel(who)} />}
        </div>
      </div>
    </div>
  );
}

function TaskDrawer({ task: t, people, roster, viewer, condition, session, onAction, busy, onClose }: {
  task: Task; people: Record<string, Person>; roster: Person[]; viewer?: Viewer | null; condition: Condition;
  session: SessionInfo; onAction?: OnAction; busy?: boolean; onClose: () => void;
}) {
  const perm = permissions(t, viewer, condition, session);
  const idx = STAGES.indexOf(t.stage as (typeof STAGES)[number]);
  const earlier = idx > 0 ? STAGES.slice(0, idx) : [];
  const [target, setTarget] = useState<string>(earlier[earlier.length - 1] ?? "");
  const act = async (a: TaskAction, body?: Record<string, unknown>) => { await onAction?.(t.key, a, body); };
  const who = t.assignee ? people[t.assignee] : null;

  return (
    <Drawer onClose={onClose} title={t.title}
      subtitle={<div className="row wrap" style={{ gap: 6 }}>
        <span className="key mono tiny muted">{t.key}</span>
        <span className="chip"><span className="swatch" style={{ background: stageColor(t.stage) }} />{t.stage}</span>
        <span className="chip outline">{t.project}</span>
        {t.milestone && <span className="chip outline"><Icon name="flag" size={12} />{t.milestone}</span>}
        {t.injected && <span className="chip warn"><Icon name="bolt" size={12} />из вброса</span>}
      </div>}>
      <p className="soft">{t.description || "Без описания."}</p>

      <div className="stack sm">
        <div className="section-title">Путь по этапам</div>
        <div className="row" style={{ gap: 4 }}>
          {STAGES.map((s, i) => (
            <div key={s} className="grow stack sm" title={s}>
              <div style={{ height: 6, borderRadius: 4, background: i <= idx ? stageColor(s) : "var(--surface-3)" }} />
              <span className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stack sm">
        <div className="section-title">Исполнитель</div>
        {who ? (
          <div className="row"><Avatar text={initials(who)} me={viewer?.participant_id === who.participant_id} />
            <span>{personLabel(who)}</span>
            {t.started && <span className="status-dot working">в работе</span>}
          </div>
        ) : <span className="muted">Не назначен</span>}
        {perm?.assign && (
          <select className="select" value={t.assignee ?? ""} disabled={busy}
            onChange={(e) => act("assign", { assignee: e.target.value || null })}>
            <option value="">— не назначен —</option>
            {roster.map((p) => <option key={p.participant_id} value={p.participant_id}>{personLabel(p)}</option>)}
          </select>
        )}
      </div>

      {perm ? (
        <div className="stack">
          <div className="section-title">Действия</div>
          {perm.sprint && (
            <button className="btn" disabled={busy} onClick={() => act("sprint", { add: t.sprint === null })}>
              {t.sprint === null ? `Добавить в спринт ${session.current_sprint}` : "Убрать из спринта"}
            </button>
          )}
          {perm.pull && <button className="btn primary" disabled={busy} onClick={() => act("pull")}>Взять из бэклога в анализ <Icon name="arrow" /></button>}
          {perm.start && <button className="btn primary" disabled={busy} onClick={() => act("start")}><Icon name="play" />Взять в работу</button>}
          {perm.advance && (
            <button className="btn primary" disabled={busy} onClick={() => act("advance")}>
              {t.stage === "Контроль" ? "Принять и сдать" : `Передать на «${STAGES[idx + 1]}»`} <Icon name="arrow" />
            </button>
          )}
          {perm.ret && earlier.length > 0 && (
            <div className="row">
              <select className="select grow" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Вернуть на этап">
                {earlier.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn danger" disabled={busy} onClick={() => act("return", { to: target })}>
                <Icon name="rework" />Вернуть
              </button>
            </div>
          )}
          {!perm.pull && !perm.start && !perm.advance && !perm.ret && !perm.assign && !perm.sprint && (
            <p className="small muted">Сейчас у вас нет действий с этой задачей.</p>
          )}
        </div>
      ) : viewer ? <p className="small muted">Доска доступна в рабочей фазе.</p> : null}
    </Drawer>
  );
}
