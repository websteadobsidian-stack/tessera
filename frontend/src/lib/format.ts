import type { Condition, Phase } from "./types";

export const STAGES = ["Анализ", "Проектирование", "Исполнение", "Контроль", "Сдача"] as const;
export const BACKLOG = "Бэклог";
export const COLUMNS = [BACKLOG, ...STAGES] as const;
export type Stage = (typeof STAGES)[number];

export const stageColor = (stage: string) => `var(--st-${Math.max(0, COLUMNS.indexOf(stage as never))})`;
export const condColor = (c: string) => `var(--cond-${c})`;

export const CONDITIONS: { key: Condition; title: string; blurb: string }[] = [
  { key: "kanban", title: "Kanban", blurb: "Поток и лимиты незавершённой работы" },
  { key: "sprints", title: "Спринты", blurb: "Короткие итерации с планированием" },
  { key: "hierarchy", title: "Иерархия", blurb: "Руководитель распределяет и решает" },
  { key: "self_org", title: "Самоорганизация", blurb: "Правила команда задаёт сама" },
];
export const conditionTitle = (c: string) => CONDITIONS.find((x) => x.key === c)?.title ?? c;

export const PHASES: { key: Phase; title: string; short: string; hint: string }[] = [
  { key: "lobby", title: "Сбор команды", short: "Сбор", hint: "Участники входят по коду, дают согласие и выбирают роли." },
  { key: "entry", title: "Входной замер", short: "Вход", hint: "Психологическая безопасность и ясность целей — до начала работы." },
  { key: "briefing", title: "Брифинг", short: "Брифинг", hint: "Легенда, правила методики, секретные факты, личный выбор, прогноз, договор." },
  { key: "work", title: "Рабочая сессия", short: "Работа", hint: "Запускаются таймер, сроки вех и таймлайн протокола." },
  { key: "pulse", title: "Пульс-опрос", short: "Пульс", hint: "Нагрузка, уверенность в решении, Зеркало и оценки коллег." },
  { key: "debrief", title: "Разбор", short: "Разбор", hint: "Команда видит портрет и карту своего процесса. Разбор ведёте вы." },
  { key: "retro", title: "Ретро", short: "Ретро", hint: "Начать / перестать / продолжить. Лучшее станет договорённостями." },
  { key: "exit", title: "Выходной замер", short: "Выход", hint: "Повтор шкал, сильные стороны коллег, проверка договорённостей." },
  { key: "closed", title: "Сессия завершена", short: "Финал", hint: "Портрет команды и личные карточки." },
];
export const phaseTitle = (p: string) => PHASES.find((x) => x.key === p)?.title ?? p;
export const phaseIndex = (p: string) => PHASES.findIndex((x) => x.key === p);

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

export const clockSec = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

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

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.round(Math.abs(totalSeconds)));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ago(iso: string, nowMs = Date.now()) {
  const sec = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (sec < 45) return "только что";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин назад`;
  return clock(iso);
}

export const LANES = {
  start: { title: "Начать", hint: "Что стоит начать делать" },
  stop: { title: "Перестать", hint: "Что мешало и от чего отказаться" },
  continue: { title: "Продолжить", hint: "Что сработало — сохранить" },
} as const;

export const SIGNAL_TONE: Record<string, string> = { bad: "bad", warn: "warn", info: "accent" };
