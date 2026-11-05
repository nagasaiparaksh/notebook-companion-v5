// Hand-drawn geometry shared by the Konva canvas and the SVG exporter, so both look identical.
export type El = { id: string; type: "rect" | "ellipse" | "diamond" | "text" | "arrow"; x: number; y: number; w: number; h: number; rotation: number;
  text?: string; fontSize: number; fill: string; stroke: string; strokeWidth: number; seed: number; group: string | null; from?: string; to?: string };
const rng = (seed: number) => { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; }; };
const P = (pts: number[][], close = true) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("") + (close ? "Z" : "");
export function shapePath(e: El): string {
  const r = rng(e.seed), j = () => r() * 5, { w, h } = e;
  if (e.type === "rect") { const c = [[0, 0], [w / 2, 0], [w, 0], [w, h / 2], [w, h], [w / 2, h], [0, h], [0, h / 2]].map(([x, y]) => [x + j(), y + j()]);
    return P(c) + P([[2 + j(), -2 + j()], [w * .6 + j(), 1 + j()]], false); }
  if (e.type === "diamond") return P([[w / 2 + j(), j()], [w + j(), h / 2 + j()], [w / 2 + j(), h + j()], [j(), h / 2 + j()]]);
  const pts = []; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; pts.push([w / 2 + Math.cos(a) * (w / 2 + j() * .6), h / 2 + Math.sin(a) * (h / 2 + j() * .6)]); }
  return P(pts);
}
const byId = (els: El[], id?: string) => els.find((e) => e.id === id);
const center = (e: El) => [e.x + e.w / 2, e.y + e.h / 2];
function edge(e: El, tx: number, ty: number) { // point on e's outline toward (tx,ty)
  const [cx, cy] = center(e), dx = tx - cx, dy = ty - cy; if (!dx && !dy) return [cx, cy]; const a = e.w / 2 + 3, b = e.h / 2 + 3;
  const t = e.type === "ellipse" ? 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2) : e.type === "diamond" ? 1 / (Math.abs(dx) / a + Math.abs(dy) / b) : 1 / Math.max(Math.abs(dx) / a, Math.abs(dy) / b);
  return [cx + dx * t, cy + dy * t];
}
export function arrowGeom(e: El, els: El[]) {
  const A = byId(els, e.from), B = byId(els, e.to);
  let x1 = e.x, y1 = e.y, x2 = e.x + e.w, y2 = e.y + e.h;
  if (A && B) { [x1, y1] = edge(A, ...(center(B) as [number, number])); [x2, y2] = edge(B, ...(center(A) as [number, number])); }
  else if (A) { [x1, y1] = edge(A, x2, y2); } else if (B) { [x2, y2] = edge(B, x1, y1); }
  const r = rng(e.seed), mx = (x1 + x2) / 2 + r() * 14, my = (y1 + y2) / 2 + r() * 14, ang = Math.atan2(y2 - my, x2 - mx), L = 14 + e.strokeWidth * 2;
  const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}` +
    [0.45, -0.45].map((s) => `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(x2 - Math.cos(ang + s) * L).toFixed(1)} ${(y2 - Math.sin(ang + s) * L).toFixed(1)}`).join("");
  return { d, label: [(x1 + 2 * mx + x2) / 4, (y1 + 2 * my + y2) / 4] };
}
export function bbox(els: El[]) {
  if (!els.length) return { x: 0, y: 0, w: 400, h: 300 }; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const e of els) { const pts = e.type === "arrow" ? [arrowGeom(e, els).label] : [[e.x, e.y], [e.x + e.w, e.y + e.h]]; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  return { x: x0 - 30, y: y0 - 30, w: x1 - x0 + 60, h: y1 - y0 + 60 };
}
const X = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function lines(t: string, w: number, fs: number) { const max = Math.max(4, Math.floor(w / (fs * 0.5))), out: string[] = []; let cur = ""; for (const word of t.split(/\s+/)) { if ((cur + " " + word).trim().length > max && cur) { out.push(cur); cur = word; } else cur = (cur + " " + word).trim(); } if (cur) out.push(cur); return out; }
export function toSvg(els: El[], white = false) {
  const b = bbox(els), F = "font-family=\"'Patrick Hand',cursive\"";
  const body = els.map((e) => {
    if (e.type === "arrow") { const g = arrowGeom(e, els); return `<path d="${g.d}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linecap="round"/>` + (e.text ? `<text x="${g.label[0]}" y="${g.label[1] - 6}" font-size="${e.fontSize}" text-anchor="middle" fill="#2B2B2B" ${F}>${X(e.text)}</text>` : ""); }
    const tx = (cy: number) => { const ls = lines(e.text || "", e.w - 12, e.fontSize); return ls.map((l, i) => `<text x="${e.w / 2}" y="${cy + (i - (ls.length - 1) / 2) * e.fontSize * 1.15}" font-size="${e.fontSize}" text-anchor="middle" dominant-baseline="middle" fill="#2B2B2B" ${F}>${X(l)}</text>`).join(""); };
    const tr = `transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.w / 2} ${e.h / 2})"`;
    return e.type === "text" ? `<g ${tr}>${tx(e.h / 2)}</g>` : `<g ${tr}><path d="${shapePath(e)}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linejoin="round"/>${tx(e.h / 2)}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w}" height="${b.h}">${white ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#fff"/>` : ""}${body}</svg>`;
}
