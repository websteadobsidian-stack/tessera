import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

const fmt = (v: number, decimals: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: decimals, useGrouping: false });

/** Число со степпером: − значение +, удержание кнопки — быстрый шаг, стрелки на клавиатуре. */
export function NumberField({ value, onChange, min = -Infinity, max = Infinity, step = 1, decimals = 0, suffix, label, size, disabled, width }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; decimals?: number;
  suffix?: string; label: string; size?: "sm" | "md"; disabled?: boolean; width?: number | string;
}) {
  const [text, setText] = useState(fmt(value, decimals));
  const [editing, setEditing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => { if (!editing) setText(fmt(value, decimals)); }, [value, decimals, editing]);

  const clamp = (v: number) => {
    const r = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, Number(r.toFixed(Math.max(decimals, 2)))));
  };
  const bump = (d: number) => onChange(clamp(latest.current + d));
  const stop = () => window.clearTimeout(timer.current);
  const hold = (d: number) => {
    bump(d);
    const again = (delay: number) => {
      timer.current = window.setTimeout(() => { bump(d); again(Math.max(45, delay * 0.82)); }, delay);
    };
    again(380);
  };
  useEffect(() => stop, []);

  const commit = () => {
    setEditing(false);
    const v = Number(text.replace(",", ".").replace(/\s/g, ""));
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value, decimals));
  };

  return (
    <div className={`numfield ${size ?? ""} ${disabled ? "disabled" : ""}`} style={width ? { width } : undefined}>
      <button type="button" tabIndex={-1} aria-label={`${label}: меньше`} disabled={disabled || value <= min}
        onPointerDown={(e) => { e.preventDefault(); hold(-step); }} onPointerUp={stop} onPointerLeave={stop}><Minus size={size === "sm" ? 13 : 15} /></button>
      <span className="nf-core">
        <input value={text} inputMode="decimal" aria-label={label} disabled={disabled}
          style={{ width: `${Math.max(2, text.length) + 0.6}ch` }}
          onFocus={(e) => { setEditing(true); e.currentTarget.select(); }} onBlur={commit}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp") { e.preventDefault(); bump(step); }
            if (e.key === "ArrowDown") { e.preventDefault(); bump(-step); }
          }} />
        {suffix && <span className="nf-suffix">{suffix}</span>}
      </span>
      <button type="button" tabIndex={-1} aria-label={`${label}: больше`} disabled={disabled || value >= max}
        onPointerDown={(e) => { e.preventDefault(); hold(step); }} onPointerUp={stop} onPointerLeave={stop}><Plus size={size === "sm" ? 13 : 15} /></button>
    </div>
  );
}
