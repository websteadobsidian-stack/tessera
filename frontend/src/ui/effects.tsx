import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* Салют из плиток мозаики — для достижений и финала. */

const COLORS = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)", "var(--accent)", "var(--p7)"];

export function TileBurst({ trigger, count = 42 }: { trigger: number; count?: number }) {
  const [bursts, setBursts] = useState<number[]>([]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!trigger) return;
    setBursts((b) => [...b, trigger]);
    const t = window.setTimeout(() => setBursts((b) => b.filter((x) => x !== trigger)), 2200);
    return () => window.clearTimeout(t);
  }, [trigger]);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 80, overflow: "hidden" }} aria-hidden>
      <AnimatePresence>
        {bursts.map((b) => <Burst key={b} seed={b} count={count} />)}
      </AnimatePresence>
    </div>
  );
}

function Burst({ seed, count }: { seed: number; count: number }) {
  const pieces = useMemo(() => {
    let s = Math.floor(seed) % 2147483647;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: count }, (_, i) => {
      const angle = rnd() * Math.PI * 2;
      const dist = 140 + rnd() * 320;
      return {
        i, color: COLORS[i % COLORS.length], size: 8 + rnd() * 12,
        x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.7 - 120 - rnd() * 80,
        rot: (rnd() - 0.5) * 540, delay: rnd() * 0.12,
      };
    });
  }, [seed, count]);
  return (
    <motion.div style={{ position: "absolute", left: "50%", top: "42%" }} exit={{ opacity: 0 }}>
      {pieces.map((p) => (
        <motion.span key={p.i}
          style={{ position: "absolute", width: p.size, height: p.size, borderRadius: p.size * 0.25, background: p.color,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.3)" }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.4 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 260], rotate: p.rot, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: 1.9, delay: p.delay, ease: [0.15, 0.7, 0.3, 1], times: [0, 0.45, 1] }} />
      ))}
    </motion.div>
  );
}

/** Плавное появление блока при прокрутке. */
export function Reveal({ children, delay = 0, y = 14 }: { children: ReactNode; delay?: number; y?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

/** Переход между экранами фаз. Только прозрачность и сдвиг: filter/transform у предка
    ломают position: fixed у потомков (шторки, модалки, быстрые кнопки) — после анимации transform снимается. */
export function PhaseTransition({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div key={phase} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
