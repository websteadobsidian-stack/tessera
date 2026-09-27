import { BACKLOG, STAGES } from "../lib/format";
import type { Condition, SessionInfo, Task } from "../lib/types";

export type TaskAction = "pull" | "start" | "advance" | "return" | "assign" | "sprint";
export type OnAction = (key: string, action: TaskAction, body?: Record<string, unknown>) => Promise<boolean>;

export interface Viewer {
  participant_id: string;
  is_pm: boolean;
  away?: boolean;
}

const LAST = STAGES[STAGES.length - 1];
const IN_FLOW: readonly string[] = STAGES.slice(0, -1);
const RETURNABLE: readonly string[] = STAGES.slice(1, -1);

/** Зеркало серверных правил (core.task_action): чтобы не показывать кнопки, которые всё равно откажут. */
export function permissions(t: Task, v: Viewer | null | undefined, condition: Condition, session: SessionInfo) {
  if (!v || session.phase !== "work" || v.away) return null;
  const hier = condition === "hierarchy";
  const mine = t.assignee === v.participant_id;
  const boss = hier && v.is_pm;
  const inFlow = IN_FLOW.includes(t.stage);
  return {
    pull: t.stage === BACKLOG && (!hier || v.is_pm) &&
      (condition !== "sprints" || (t.sprint !== null && t.sprint <= session.current_sprint)),
    start: inFlow && !t.started && (hier ? mine || (v.is_pm && !t.assignee) : true),
    takeover: !hier && inFlow && !t.started && !!t.assignee && !mine,
    advance: inFlow && t.started && (mine || boss),
    ret: RETURNABLE.includes(t.stage) && (!t.assignee || mine || boss) && (!hier || mine || v.is_pm),
    assign: t.stage !== LAST && (!hier || v.is_pm),
    sprint: condition === "sprints" && t.stage === BACKLOG,
  };
}

export type Perm = NonNullable<ReturnType<typeof permissions>>;

/** Главное действие прямо на карточке. Перехват чужой задачи — только из карточки задачи, чтобы не случайно. */
export function quickAction(t: Task, perm: Perm | null): { label: string; action: TaskAction; body?: Record<string, unknown> } | null {
  if (!perm) return null;
  if (perm.advance) return { label: t.stage === "Контроль" ? "Сдать" : "Дальше", action: "advance" };
  if (perm.pull) return { label: "В анализ", action: "pull" };
  if (perm.start && !perm.takeover) return { label: "Взять", action: "start" };
  if (perm.sprint && t.sprint === null) return { label: "В спринт", action: "sprint", body: { add: true } };
  return null;
}

export function stageIndex(stage: string) {
  return (STAGES as readonly string[]).indexOf(stage);
}
