import { useEffect, useRef } from "react";

/* Живая мозаика для главной: плитки собираются волной от центра, откликаются на курсор
   и изредка меняют цвет — как команда, где каждый фрагмент живёт своей жизнью. */

const PALETTE_VARS = ["--p1", "--p2", "--p3", "--p4", "--p5", "--accent", "--p7", "--st-3"];

export function HeroCanvas({ className, density = 26 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0, h = 0, cols = 0, rows = 0, cell = 0;
    let tiles: { color: number; next: number; t: number; lift: number; delay: number; phase: number; blank: boolean }[] = [];
    const mouse = { x: -9999, y: -9999 };
    let colors: string[] = [];
    let empty = "#222";
    const start = performance.now();

    const readColors = () => {
      const st = getComputedStyle(document.documentElement);
      colors = PALETTE_VARS.map((v) => st.getPropertyValue(v).trim() || "#888");
      empty = st.getPropertyValue("--glass-2").trim() || "rgba(255,255,255,.06)";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width; h = rect.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(18, Math.min(44, w / density));
      cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
      const cx = cols / 2, cy = rows / 2;
      tiles = Array.from({ length: cols * rows }, (_, i) => {
        const x = i % cols, y = Math.floor(i / cols);
        const d = Math.hypot(x - cx, (y - cy) * 1.1) / Math.hypot(cx, cy);
        const blank = Math.random() < 0.18 + d * 0.55;
        return { color: Math.floor(Math.random() * colors.length), next: -1, t: 0, lift: 0, delay: d * 900 + Math.random() * 250,
          phase: Math.random() * Math.PI * 2, blank };
      });
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const elapsed = now - start;
      const gap = cell * 0.14;
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
        const appear = reduced ? 1 : Math.min(1, Math.max(0, (elapsed - tile.delay) / 520));
        if (appear <= 0) continue;
        const dx = x + cell / 2 - mouse.x, dy = y + cell / 2 - mouse.y;
        const near = Math.max(0, 1 - Math.hypot(dx, dy) / (cell * 4.2));
        tile.lift += (near - tile.lift) * 0.12;
        if (!reduced && !tile.blank && tile.next < 0 && Math.random() < 0.0009) tile.next = Math.floor(Math.random() * colors.length);
        if (tile.next >= 0) {
          tile.t += 0.035;
          if (tile.t >= 1) { tile.color = tile.next; tile.next = -1; tile.t = 0; }
        }
        const breathe = reduced ? 0 : Math.sin(now / 1800 + tile.phase) * 0.04;
        const scale = (0.55 + 0.45 * easeOut(appear)) * (1 + tile.lift * 0.16);
        const size = (cell - gap) * scale;
        const ox = x + (cell - size) / 2, oy = y + (cell - size) / 2 - tile.lift * 3;
        ctx.globalAlpha = appear * (tile.blank ? 0.55 + tile.lift * 0.4 : 0.72 + breathe + tile.lift * 0.28);
        ctx.fillStyle = tile.blank && tile.lift < 0.15 ? empty : colors[tile.next >= 0 && tile.t > 0.5 ? tile.next : tile.color];
        roundRect(ctx, ox, oy, size, size, size * 0.24);
        ctx.fill();
        if (!tile.blank || tile.lift > 0.15) {
          ctx.globalAlpha = appear * 0.18;
          ctx.fillStyle = "#fff";
          roundRect(ctx, ox, oy, size, size * 0.45, size * 0.24);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    readColors();
    resize();
    raf = requestAnimationFrame(draw);
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    const onResize = () => { resize(); if (reduced) draw(performance.now()); };
    const obs = new MutationObserver(readColors);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [density]);

  return <canvas ref={ref} className={className} aria-hidden style={{ width: "100%", height: "100%", display: "block" }} />;
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
