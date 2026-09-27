import type { Person } from "./types";

/** Цвет участника — его слот категориальной палитры (провалидирована для обеих тем). */
export const personColor = (slot: number | null | undefined) => `var(--p${Math.min(8, Math.max(1, slot || 1))})`;

type Named = { display_name?: string | null; role_title?: string; role?: string };

export function initials(p: Named | null | undefined): string {
  if (!p) return "?";
  const src = (p.display_name?.trim() || p.role_title || p.role || "?").replace(/[«»"]/g, "");
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function shortName(p: Named | null | undefined): string {
  if (!p) return "—";
  return p.display_name?.trim() || capitalize(p.role_title || p.role || "—");
}

export function fullName(p: Named | null | undefined): string {
  if (!p) return "—";
  const role = p.role_title || p.role || "";
  return p.display_name ? `${p.display_name} · ${role}` : capitalize(role);
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function byId(roster: Person[]): Record<string, Person> {
  return Object.fromEntries(roster.map((p) => [p.participant_id, p]));
}

export const WEATHER = [
  { value: 4, id: "clear", title: "Ясно", hint: "всё получается" },
  { value: 3, id: "cloudy", title: "Переменно", hint: "по-разному" },
  { value: 2, id: "rain", title: "Тяжело", hint: "трудно, но держусь" },
  { value: 1, id: "storm", title: "Буря", hint: "нужна поддержка" },
];
export const weatherTitle = (v: number | null | undefined) => WEATHER.find((w) => w.value === Math.round(v ?? 0))?.title ?? "—";
