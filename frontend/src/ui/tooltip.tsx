import { useCallback, useState, type ReactNode } from "react";

/** Один плавающий тултип на график. Контент — React-узлы (без innerHTML). */
export function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div className="tooltip" style={{
      left: Math.min(tip.x + 14, window.innerWidth - 310),
      top: Math.max(8, tip.y - 12),
      transform: "translateY(-100%)",
    }}>{tip.content}</div>
  ) : null;
  return { show, hide, node };
}

export function TipValue({ value, label }: { value: ReactNode; label: ReactNode }) {
  return <div><div className="tv">{value}</div><div className="tl">{label}</div></div>;
}
