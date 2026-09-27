import { AnimatePresence, motion } from "motion/react";
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Текст для поиска и «набора с клавиатуры»; если label — строка, берётся он. */
  text?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T | null | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Поиск в списке; по умолчанию — если вариантов больше восьми. */
  searchable?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
  style?: CSSProperties;
  menuWidth?: number;
  /** Показывать подсказку выбранного варианта второй строкой в самом поле. */
  showHint?: boolean;
}

const textOf = (o: SelectOption) => (o.text ?? (typeof o.label === "string" ? o.label : String(o.value))).toLowerCase();

/** Выпадающий список Tessera: иконки и подсказки у вариантов, поиск, клавиатура; на телефоне — нижняя шторка. */
export function Select<T extends string>({
  value, options, onChange, placeholder = "Выберите…", size = "md", searchable, disabled, label, className, style, menuWidth, showHint,
}: SelectProps<T>) {
  const uid = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button ref={triggerRef} type="button" className={`picker ${size} ${className ?? ""}`} style={style} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined} aria-label={label}
        onClick={() => setOpen((x) => !x)} onKeyDown={onTriggerKey}>
        {selected?.icon && <span className="pk-icon">{selected.icon}</span>}
        <span className="pk-value">
          {selected ? <span className="pk-label">{selected.label}</span> : <span className="pk-label pk-placeholder">{placeholder}</span>}
          {showHint && selected?.hint && <span className="pk-hint">{selected.hint}</span>}
        </span>
        <ChevronDown size={size === "sm" ? 14 : 16} className="pk-chev" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <Menu uid={uid} anchor={triggerRef} options={options} value={value ?? null} label={label}
              searchable={searchable ?? options.length > 8} menuWidth={menuWidth}
              onPick={(v) => { onChange(v); close(); }} onClose={close} />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function Menu<T extends string>({ uid, anchor, options, value, label, searchable, menuWidth, onPick, onClose }: {
  uid: string; anchor: React.RefObject<HTMLButtonElement | null>; options: SelectOption<T>[]; value: T | null; label: string;
  searchable: boolean; menuWidth?: number; onPick: (v: T) => void; onClose: (focus?: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxH: number } | null>(null);
  const mobile = typeof window !== "undefined" && window.innerWidth <= 640;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => textOf(o).includes(q)) : options;
  }, [options, query]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  useEffect(() => { if (query) setActive(shown.findIndex((o) => !o.disabled)); }, [query, shown]);

  // Позиция под полем; если снизу тесно — над ним.
  useLayoutEffect(() => {
    if (mobile) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, menuWidth ?? 240);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const want = Math.min(360, 56 + options.length * 46);
      if (below >= Math.min(want, 240) || below >= above) setPos({ top: r.bottom + 6, left, width, maxH: Math.max(160, below - 6) });
      else setPos({ bottom: window.innerHeight - r.top + 6, left, width, maxH: Math.max(160, above - 6) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, menuWidth, options.length, mobile]);

  // Закрытие по клику вне списка.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [anchor, onClose]);

  useEffect(() => {
    requestAnimationFrame(() => (searchable ? searchRef.current : listRef.current)?.focus());
  }, [searchable]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (d: number) => {
    if (!shown.length) return;
    let i = active;
    for (let k = 0; k < shown.length; k++) {
      i = (i + d + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(shown.findIndex((o) => !o.disabled)); }
    else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[active]; if (o && !o.disabled) onPick(o.value); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(e.key === "Escape"); }
    else if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      const i = shown.findIndex((o, k) => k > active && textOf(o).startsWith(e.key.toLowerCase()));
      const j = i >= 0 ? i : shown.findIndex((o) => textOf(o).startsWith(e.key.toLowerCase()));
      if (j >= 0) setActive(j);
    }
  };

  let lastGroup: string | undefined;
  const body = (
    <>
      {searchable && (
        <div className="sel-search">
          <Search size={15} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Поиск…"
            aria-label={`Поиск: ${label}`} aria-controls={`${uid}-list`} />
        </div>
      )}
      <div ref={listRef} id={`${uid}-list`} className="sel-list" role="listbox" aria-label={label} tabIndex={-1} onKeyDown={onKey}
        style={pos && !mobile ? { maxHeight: Math.min(320, pos.maxH - (searchable ? 48 : 0)) } : undefined}>
        {shown.length === 0 && <div className="sel-empty">Ничего не нашлось</div>}
        {shown.map((o, i) => {
          const header = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <div key={o.value}>
              {header && <div className="sel-group">{header}</div>}
              <div role="option" data-i={i} aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                className={`sel-opt ${i === active ? "active" : ""}`}
                onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => !o.disabled && onPick(o.value)}>
                {i === active && <motion.span layoutId={`${uid}-hl`} className="sel-hl" transition={{ type: "spring", stiffness: 700, damping: 45 }} />}
                {o.icon && <span className="so-icon">{o.icon}</span>}
                <span className="so-text">
                  <span className="so-label">{o.label}</span>
                  {o.hint && <span className="so-hint">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={16} className="so-check" />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  if (mobile) {
    return (
      <>
        <motion.div className="scrim" style={{ zIndex: 99 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <motion.div ref={menuRef} className="sel-sheet" role="dialog" aria-label={label}
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
          <div className="sel-sheet-head"><span className="sel-grip" /><strong>{label}</strong></div>
          {body}
        </motion.div>
      </>
    );
  }
  if (!pos) return null;
  return (
    <motion.div ref={menuRef} className="sel-menu" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
      initial={{ opacity: 0, y: pos.top !== undefined ? -6 : 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: pos.top !== undefined ? -4 : 4, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 36 }}>
      {body}
    </motion.div>
  );
}
