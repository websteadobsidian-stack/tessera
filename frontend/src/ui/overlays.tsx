import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, X } from "lucide-react";

/* ------------------------------------------------------------------ тосты */

type Toast = { id: number; text: ReactNode; kind: "ok" | "error" | "info"; icon?: ReactNode };
const ToastCtx = createContext<(text: ReactNode, kind?: Toast["kind"], icon?: ReactNode) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, kind: Toast["kind"] = "ok", icon?: ReactNode) => {
    const id = Date.now() + Math.random();
    // Одинаковые подряд не копим: освежаем последний.
    setItems((xs) => [...xs.filter((x) => typeof text !== "string" || x.text !== text).slice(-2), { id, text, kind, icon }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 5200 : 3400);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} className={`toast ${t.kind}`} layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}>
              {t.icon ?? (t.kind === "error" ? <CircleAlert size={18} /> : <CircleCheck size={18} />)}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Обёртка для действий: блокирует повторные нажатия и показывает ошибку сервера тостом. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: ReactNode) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy };
}

/* ------------------------------------------------------------------ шторка и модалка */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Sheet({ open, onClose, title, subtitle, children, width }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number;
}) {
  return createPortal(
    <AnimatePresence>
      {open && <SheetBody onClose={onClose} title={title} subtitle={subtitle} width={width}>{children}</SheetBody>}
    </AnimatePresence>,
    document.body,
  );
}

function SheetBody({ onClose, title, subtitle, children, width }: { onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  useEscape(onClose);
  const mobile = typeof window !== "undefined" && window.innerWidth <= 640;
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside className="sheet" role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, calc(100vw - 20px))` } : undefined}
        initial={mobile ? { y: "100%" } : { x: 40, opacity: 0 }} animate={mobile ? { y: 0 } : { x: 0, opacity: 1 }}
        exit={mobile ? { y: "100%" } : { x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}>
        <div className="sheet-head">
          <div className="grow stack sm">{subtitle}<h3 style={{ fontSize: 19 }}>{title}</h3></div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </motion.aside>
    </>
  );
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return createPortal(
    <AnimatePresence>
      {open && <ModalBody onClose={onClose} wide={wide}>{children}</ModalBody>}
    </AnimatePresence>,
    document.body,
  );
}

function ModalBody({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"
        initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-46%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
        exit={{ opacity: 0, scale: 0.97, x: "-50%", y: "-48%" }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
        {children}
      </motion.div>
    </>
  );
}

export function Confirm({ open, title, text, confirm = "Подтвердить", danger, onConfirm, onClose }: {
  open: boolean; title: string; text?: ReactNode; confirm?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack lg">
        <h2 style={{ fontSize: 22 }}>{title}</h2>
        {text && <div className="soft">{text}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={() => { onClose(); onConfirm(); }}>{confirm}</button>
        </div>
      </div>
    </Modal>
  );
}
