import { saveBlob } from "../lib/api";

/** Сохранить SVG как PNG: CSS-переменные подставляются вычисленными цветами. */
export async function exportSvgPng(svg: SVGSVGElement, filename: string, scale = 3) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const styles = getComputedStyle(document.documentElement);
  const resolve = (value: string | null) =>
    value?.replace(/var\((--[\w-]+)\)/g, (_, name: string) => styles.getPropertyValue(name).trim() || "#888") ?? value;
  clone.querySelectorAll("*").forEach((el) => {
    for (const attr of ["fill", "stroke", "stop-color"]) {
      const v = el.getAttribute(attr);
      if (v && v.includes("var(")) el.setAttribute(attr, resolve(v) ?? v);
    }
    const style = el.getAttribute("style");
    if (style && style.includes("var(")) el.setAttribute("style", resolve(style) ?? style);
    const opacity = (el as SVGElement).style?.opacity;
    if (opacity) el.setAttribute("opacity", opacity);
  });
  const vb = svg.viewBox.baseVal;
  const w = vb.width || svg.clientWidth, h = vb.height || svg.clientHeight;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const bg = styles.getPropertyValue("--bg").trim() || "#09090d";
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise<void>((resolveLoad, reject) => {
    img.onload = () => resolveLoad();
    img.onerror = () => reject(new Error("svg"));
    img.src = url;
  });
  const pad = 40;
  const canvas = document.createElement("canvas");
  canvas.width = (w + pad * 2) * scale;
  canvas.height = (h + pad * 2) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w + pad * 2, h + pad * 2);
  ctx.drawImage(img, pad, pad, w, h);
  ctx.fillStyle = styles.getPropertyValue("--ink-3").trim() || "#777";
  ctx.font = "600 11px 'Onest Variable', sans-serif";
  ctx.fillText("tessera · портрет команды", pad, h + pad * 1.6);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => blob && saveBlob(blob, filename), "image/png");
}
