import type { Condition, Person, Phase } from "./types";

export const STAGES = ["Анализ", "Проектирование", "Исполнение", "Контроль", "Сдача"] as const;
export const BACKLOG = "Бэклог";
export const COLUMNS = [BACKLOG, ...STAGES];

export const stageColor = (stage: string) => `var(--stage-${COLUMNS.indexOf(stage)})`;
export const condColor = (c: Condition | string) => `var(--cond-${c})`;

export const CONDITIONS: { key: Condition; title: string; blurb: string }[] = [
  { key: "kanban", title: "Kanban", blurb: "Поток и лимиты незавершённой работы" },
  { key: "sprints", title: "Спринты", blurb: "Короткие итерации с планированием" },
  { key: "hierarchy", title: "Иерархия", blurb: "Руководитель распределяет задачи" },
  { key: "self_org", title: "Самоорганизация", blurb: "Правила команда задаёт сама" },
];
export const conditionTitle = (c: string) => CONDITIONS.find((x) => x.key === c)?.title ?? c;

export const PHASES: { key: Phase; title: string; short: string }[] = [
  { key: "lobby", title: "Сбор команды", short: "Сбор" },
  { key: "entry", title: "Входной замер", short: "Вход" },
  { key: "briefing", title: "Брифинг", short: "Брифинг" },
  { key: "work", title: "Рабочая сессия", short: "Работа" },
  { key: "pulse", title: "Пульс-опрос", short: "Пульс" },
  { key: "debrief", title: "Дебрифинг", short: "Разбор" },
  { key: "exit", title: "Выходной замер", short: "Выход" },
  { key: "closed", title: "Сессия завершена", short: "Конец" },
];
export const phaseTitle = (p: string) => PHASES.find((x) => x.key === p)?.title ?? p;

export function initials(p: Pick<Person, "display_name" | "role_title"> | null | undefined): string {
  if (!p) return "—";
  const src = p.display_name?.trim() || p.role_title;
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function personLabel(p: Pick<Person, "display_name" | "role_title"> | null | undefined): string {
  if (!p) return "—";
  return p.display_name ? `${p.display_name} · ${p.role_title}` : p.role_title;
}

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

export const num = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

export const minutes = (hours: number | null | undefined) => (hours === null || hours === undefined ? null : hours * 60);

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
