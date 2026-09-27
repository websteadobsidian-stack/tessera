import { CircleDashed } from "lucide-react";
import { stageColor } from "../lib/format";
import { shortName } from "../lib/people";
import type { Person, Task } from "../lib/types";
import { PersonTile } from "./core";
import type { SelectOption } from "./select";

/** Готовые наборы вариантов для выпадающих списков: люди, этапы, задачи. */
export function personOptions(people: Person[], me?: string): SelectOption[] {
  return people.map((p) => ({
    value: p.participant_id,
    label: <>{shortName(p)}{p.participant_id === me && <span className="muted" style={{ fontWeight: 500 }}> · вы</span>}</>,
    text: `${shortName(p)} ${p.role_title}`,
    hint: p.role_title,
    icon: <PersonTile person={p} size="xs" />,
  }));
}

export const NOBODY = "__none";
export const nobodyOption = (label = "Не назначен", hint?: string): SelectOption => ({
  value: NOBODY, label, hint, icon: <CircleDashed size={18} color="var(--ink-3)" />,
});

export function stageOptions(stages: readonly string[]): SelectOption[] {
  return stages.map((s) => ({ value: s, label: s, icon: <span className="dot-ico" style={{ background: stageColor(s) }} /> }));
}

export function taskOptions(tasks: Task[], me?: string): SelectOption[] {
  return tasks.map((t) => ({
    value: t.key,
    label: <><span className="key-pill">{t.key}</span>{t.title}</>,
    text: `${t.key} ${t.title}`,
    hint: `${t.stage} · ${t.project}${t.assignee === me && me ? " · ваша" : ""}`,
    icon: <span className="dot-ico" style={{ background: stageColor(t.stage) }} />,
  }));
}
