/** Labelled diagram (e.g. "the heart"): one illustration plus part names. The drawing comes from the backend (curated library or the
 * model); labels, leader lines and styling are laid out here so they never overlap, whatever the drawing is. */
import { Palette, Rendered, ThemeId } from "./visuals";
export type LPart = { label: string; detail?: string; x: number; y: number };
export type LSpec = { title: string; drawing: string; parts: LPart[]; source?: string; id?: string };
const INK = "#2B2B2B";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const FONT: Record<ThemeId, string> = { notebook: "'Patrick Hand','Comic Sans MS','Segoe Print',cursive", mono: "'Patrick Hand','Comic Sans MS','Segoe Print',cursive", clean: "Inter,'Segoe UI',system-ui,sans-serif", bold: "Inter,'Segoe UI',system-ui,sans-serif" };
const wrapText = (t: string, max: number, maxLines: number) => {
  const out: string[] = []; let cur = "";
  for (const w of (t || "").split(/\s+/).filter(Boolean)) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur); if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, "") + "…"; } return out;
};
type Block = { p: LPart; i: number; lines: string[]; det: string[]; h: number; y: number; ay: number; ax: number };

export function renderLabelled(spec: LSpec, theme: ThemeId, pal: Palette, showTitle = false): Rendered {
  const parts = spec.parts.filter((p) => p.label.trim()).slice(0, 12); if (!parts.length || !spec.drawing) return { svg: "", w: 0, h: 0 };
  const font = FONT[theme], wide = theme === "clean" || theme === "bold", cw = wide ? 0.56 : 0.47;
  const DW = 400, DH = 400, LW = 214, GAP = 54, PAD = 22, titleH = showTitle ? 54 : 0;
  const maxChars = Math.floor((LW - 24) / (15 * cw));
  // which side: anchors left of the drawing's middle go left, the rest right; only rebalance when one column would get crowded
  const all0 = parts.map((p, i) => ({ p, i })); let left = all0.filter((o) => o.p.x < 200), right = all0.filter((o) => o.p.x >= 200);
  while (left.length - right.length > 3) { const m = left.reduce((a, b) => (a.p.x > b.p.x ? a : b)); left = left.filter((o) => o !== m); right.push(m); }
  while (right.length - left.length > 3) { const m = right.reduce((a, b) => (a.p.x < b.p.x ? a : b)); right = right.filter((o) => o !== m); left.push(m); }
  const mk = (o: { p: LPart; i: number }, side: "l" | "r"): Block => {
    const lines = wrapText(o.p.label, Math.floor((LW - 24) / (20 * cw)), 2), det = o.p.detail ? wrapText(o.p.detail, maxChars, 3) : [];
    return { p: o.p, i: o.i, lines, det, h: 20 + lines.length * 24 + (det.length ? 4 + det.length * 17 : 0), y: 0, ay: o.p.y, ax: o.p.x };
  };
  const place = (blocks: Block[], isLeft: boolean) => {
    // order by the angle each anchor is seen at from the label column: this is the order in which fanned-out leader lines never cross
    const cx = isLeft ? -GAP : DW + GAP, my = blocks.reduce((t, b) => t + b.ay, 0) / (blocks.length || 1);
    blocks.sort((a, b) => Math.atan2(a.ay - my, Math.abs(a.ax - cx)) - Math.atan2(b.ay - my, Math.abs(b.ax - cx)) || a.ay - b.ay); const GAPY = 12;
    blocks.forEach((b) => (b.y = b.ay - b.h / 2));
    for (let i = 1; i < blocks.length; i++) if (blocks[i].y < blocks[i - 1].y + blocks[i - 1].h + GAPY) blocks[i].y = blocks[i - 1].y + blocks[i - 1].h + GAPY;
    const over = blocks.length ? blocks[blocks.length - 1].y + blocks[blocks.length - 1].h - (DH + 10) : 0;   // pull back up if pushed past the bottom
    if (over > 0) for (let i = blocks.length - 1; i >= 0; i--) { blocks[i].y -= over; if (i < blocks.length - 1 && blocks[i].y + blocks[i].h + GAPY > blocks[i + 1].y) blocks[i].y = blocks[i + 1].y - GAPY - blocks[i].h; }
    const top = blocks.length ? blocks[0].y : 0; if (top < -10) blocks.forEach((b) => (b.y -= top + 10));
  };
  const L = left.map((o) => mk(o, "l")), R = right.map((o) => mk(o, "r")); place(L, true); place(R, false);
  const all = [...L, ...R], minY = Math.min(0, ...all.map((b) => b.y)), maxY = Math.max(DH, ...all.map((b) => b.y + b.h));
  const W = PAD * 2 + LW * 2 + GAP * 2 + DW, H = PAD * 2 + titleH + (maxY - minY), oy = PAD + titleH - minY, ox = PAD + LW + GAP;
  const out: string[] = [], accent = pal.accent;
  const line = theme === "notebook" ? accent : theme === "clean" ? "#8A93A6" : theme === "bold" ? INK : INK;
  const card = (b: Block, i: number, x: number, y: number) => {
    const light = pal.light[i % pal.light.length], solid = pal.solid[i % pal.solid.length];
    const fill = theme === "bold" ? solid : theme === "clean" || theme === "mono" ? "#fff" : light, strokeC = theme === "bold" ? INK : theme === "clean" ? "#D5DAE5" : theme === "mono" ? INK : accent;
    const tc = theme === "bold" ? "#fff" : INK, dc = theme === "bold" ? "#F2F2F2" : "#555", ty = y + 12 + 18;
    const rect = `<rect x="${x}" y="${y}" width="${LW}" height="${b.h}" rx="${theme === "notebook" ? 12 : 10}" fill="${fill}" stroke="${strokeC}" stroke-width="${theme === "clean" ? 1.5 : 2.5}"${theme === "clean" ? ' filter="url(#sh)"' : ""}/>`;
    const t1 = b.lines.map((s, k) => `<text x="${x + 12}" y="${ty + k * 24}" font-size="20" fill="${tc}" font-family="${font}" font-weight="${wide ? 700 : 400}">${esc(s)}</text>`).join("");
    const t2 = b.det.map((s, k) => `<text x="${x + 12}" y="${ty + b.lines.length * 24 + 2 + k * 17}" font-size="14.5" fill="${dc}" font-family="${font}">${esc(s)}</text>`).join("");
    return rect + t1 + t2;
  };
  const leaders: string[] = [], cards: string[] = [], dots: string[] = [];
  const side = (blocks: Block[], isLeft: boolean) => blocks.forEach((b) => {
    const x = isLeft ? PAD : PAD + LW + GAP * 2 + DW, y = b.y - minY + PAD + titleH, ly = y + b.h / 2, ex = isLeft ? PAD + LW : x;      // edge of the card facing the drawing
    const ax = ox + b.ax, ay = oy + b.ay, kx = isLeft ? PAD + LW + GAP * 0.55 : PAD + LW + GAP + DW + GAP * 0.45;                    // elbow just outside the card column
    leaders.push(`<polyline points="${ex},${ly} ${kx},${ly} ${ax},${ay}" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/><polyline points="${ex},${ly} ${kx},${ly} ${ax},${ay}" fill="none" stroke="${line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
    dots.push(`<circle cx="${ax}" cy="${ay}" r="6" fill="${theme === "bold" ? pal.solid[b.i % pal.solid.length] : accent}" stroke="#fff" stroke-width="2.5"/>`);
    cards.push(card(b, b.i, x, y));
  });
  side(L, true); side(R, false);
  out.push(`<g transform="translate(${ox} ${oy})">${spec.drawing}</g>`, ...leaders, ...dots, ...cards);
  const head = titleH ? `<text x="${W / 2}" y="${PAD + 24}" font-size="30" text-anchor="middle" fill="${INK}" font-family="${font}" font-weight="${wide ? 700 : 400}">${esc(spec.title)}</text>` : "";
  const defs = theme === "clean" ? `<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1b2540" flood-opacity=".14"/></filter></defs>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}${head}${out.join("")}</svg>`;
  return { svg, w: W, h: Math.ceil(H) };
}
export const altForLabelled = (s: LSpec) => `Labelled diagram: ${s.title}. Parts: ${s.parts.map((p) => p.label).join(", ")}`.slice(0, 300);
