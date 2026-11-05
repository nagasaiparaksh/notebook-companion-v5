/** Renders a structured visual spec (what the AI understood from the text) into SVG, in several layouts and styles - the Napkin-style gallery. */
export type VNode = { id: string; label: string; detail?: string; icon?: string; group?: string; parent?: string };
export type VSpec = { title: string; kinds: string[]; nodes: VNode[] };
export type ThemeId = "notebook" | "clean" | "bold" | "mono";
export type Palette = { id: string; name: string; light: string[]; solid: string[]; accent: string };
export type Rendered = { svg: string; w: number; h: number };

export const KIND_LABEL: Record<string, string> = { process: "Process", cycle: "Cycle", hierarchy: "Hierarchy", mindmap: "Mind map", comparison: "Comparison", timeline: "Timeline", list: "List" };
export const ALL_KINDS = Object.keys(KIND_LABEL);
export const THEMES: { id: ThemeId; name: string }[] = [{ id: "notebook", name: "Notebook" }, { id: "clean", name: "Clean" }, { id: "bold", name: "Bold" }, { id: "mono", name: "Ink" }];
export const PALETTES: Palette[] = [
  { id: "pastel", name: "Pastel", light: ["#FFF3A3", "#C9F2DD", "#FFD0C2", "#D9D2FF", "#BFD4FF", "#FFE0C7"], solid: ["#B7791F", "#2E9E6B", "#E5604A", "#7B61D9", "#3B5BDB", "#D9731F"], accent: "#3B5BDB" },
  { id: "ocean", name: "Ocean", light: ["#CFE8FF", "#BDEBF2", "#D6E4FF", "#C8F0E4", "#E0E9FF", "#BFE3F5"], solid: ["#1F6FB2", "#127C8C", "#3B5BDB", "#1B8F78", "#4A63C9", "#16799F"], accent: "#1F6FB2" },
  { id: "sunset", name: "Sunset", light: ["#FFD9C0", "#FFC9D6", "#FFE7A8", "#FFCFB3", "#F9C6E5", "#FFE0C7"], solid: ["#E8590C", "#D6336C", "#C47F00", "#C2410C", "#AE3EC9", "#D9480F"], accent: "#D6336C" },
  { id: "forest", name: "Forest", light: ["#D3F0C8", "#E6F3B8", "#C0E8D4", "#F3F0B5", "#CDEBDD", "#E2F0C0"], solid: ["#2F8F46", "#557A12", "#1F8A70", "#6B7012", "#2B7A5A", "#4C7A22"], accent: "#2F8F46" },
  { id: "slate", name: "Slate", light: ["#E6E9F0", "#DDE3EE", "#EEF0F5", "#D9DEE8", "#E9ECF2", "#E1E5ED"], solid: ["#3D4A63", "#4C5A78", "#2F3B52", "#56637F", "#3A465E", "#475572"], accent: "#3D4A63" },
];

const INK = "#2B2B2B";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const EMOJI = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const FONTS: Record<ThemeId, string> = { notebook: "'Patrick Hand','Comic Sans MS','Segoe Print',cursive", mono: "'Patrick Hand','Comic Sans MS','Segoe Print',cursive", clean: "Inter,'Segoe UI',system-ui,sans-serif", bold: "Inter,'Segoe UI',system-ui,sans-serif" };
const rng = (seed: number) => { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; }; };

type C = { theme: ThemeId; pal: Palette; font: string; cw: number; out: string[]; hand: boolean };
const wrap = (c: C, text: string, widthPx: number, fs: number) => {
  const max = Math.max(5, Math.floor(widthPx / (fs * c.cw))), out: string[] = []; let cur = "";
  for (const w of (text || "").split(/\s+/).filter(Boolean)) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur); return out.slice(0, 4);
};
const textColor = (c: C) => (c.theme === "bold" ? "#fff" : INK);
const stroke = (c: C) => (c.theme === "notebook" ? c.pal.accent : c.theme === "clean" ? "#8A93A6" : INK);

type Size = { w: number; h: number };
type Mode = "center" | "left";
function inner(c: C, n: VNode, w: number, mode: Mode) {
  const textW = mode === "left" ? w - 84 : w - 28;
  const l = wrap(c, n.label, textW, 21), d = n.detail ? wrap(c, n.detail, textW, 15).slice(0, 3) : [];
  const icon = mode === "center" && n.icon ? 38 : 0;
  const h = icon + l.length * 25 + (d.length ? 6 + d.length * 18 : 0);
  return { l, d, icon, h, textW };
}
function cardSize(c: C, nodes: VNode[], w: number, mode: Mode = "center"): Size {
  let h = mode === "left" ? 76 : 84;
  for (const n of nodes) h = Math.max(h, inner(c, n, w, mode).h + 30);
  return { w, h };
}
function shape(c: C, x: number, y: number, w: number, h: number, i: number, emphasis = false) {
  const light = c.pal.light[i % c.pal.light.length], solid = c.pal.solid[i % c.pal.solid.length];
  if (c.theme === "notebook") {
    const r = rng(i * 7 + 3), j = () => r() * 5, P = [[0, 0], [w / 2, 0], [w, 0], [w, h / 2], [w, h], [w / 2, h], [0, h], [0, h / 2]].map(([px, py]) => `${(x + px + j()).toFixed(1)} ${(y + py + j()).toFixed(1)}`);
    return `<path d="M${P.join("L")}Z" fill="${light}" stroke="${INK}" stroke-width="${emphasis ? 4 : 2.5}" stroke-linejoin="round"/>`;
  }
  if (c.theme === "clean") return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" stroke="#D8DCE6" stroke-width="1.5" filter="url(#sh)"/><path d="M${x + 14} ${y}h${w - 28}a14 14 0 0 1 0 0" stroke="${solid}" stroke-width="0"/><rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${solid}"/>`;
  if (c.theme === "bold") return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${solid}"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff" stroke="${INK}" stroke-width="2"/>`;
}
function card(c: C, n: VNode, x: number, y: number, w: number, h: number, i: number, mode: Mode = "center", emphasis = false) {
  c.out.push(shape(c, x, y, w, h, i, emphasis));
  const t = inner(c, n, w, mode), col = textColor(c), weight = c.theme === "clean" || c.theme === "bold" ? 600 : 400;
  if (mode === "left") {
    const cy = y + h / 2, solid = c.pal.solid[i % c.pal.solid.length];
    if (n.icon) { c.out.push(`<circle cx="${x + 38}" cy="${cy}" r="22" fill="${c.theme === "bold" ? "rgba(255,255,255,.22)" : c.pal.light[(i + 2) % c.pal.light.length]}" stroke="${c.theme === "notebook" ? INK : "none"}" stroke-width="1.8"/><text x="${x + 38}" y="${cy + 1}" font-size="24" text-anchor="middle" dominant-baseline="middle" font-family="${EMOJI}">${n.icon}</text>`); }
    else c.out.push(`<circle cx="${x + 38}" cy="${cy}" r="16" fill="${c.theme === "bold" ? "rgba(255,255,255,.25)" : solid}"/><text x="${x + 38}" y="${cy + 1}" font-size="17" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="${c.font}" font-weight="600">${i + 1}</text>`);
    let ty = cy - t.h / 2 + 12; const tx = x + 74;
    t.l.forEach((s) => { c.out.push(`<text x="${tx}" y="${ty}" font-size="21" fill="${col}" font-family="${c.font}" font-weight="${weight}" dominant-baseline="middle">${esc(s)}</text>`); ty += 25; });
    if (t.d.length) { ty += 6; t.d.forEach((s) => { c.out.push(`<text x="${tx}" y="${ty - 4}" font-size="15" fill="${col}" fill-opacity=".72" font-family="${c.font}" dominant-baseline="middle">${esc(s)}</text>`); ty += 18; }); }
    return;
  }
  let ty = y + (h - t.h) / 2; const cx = x + w / 2;
  if (t.icon) { c.out.push(`<text x="${cx}" y="${ty + 19}" font-size="30" text-anchor="middle" dominant-baseline="middle" font-family="${EMOJI}">${n.icon}</text>`); ty += t.icon; }
  t.l.forEach((s) => { c.out.push(`<text x="${cx}" y="${ty + 12}" font-size="21" text-anchor="middle" fill="${col}" font-family="${c.font}" font-weight="${weight}" dominant-baseline="middle">${esc(s)}</text>`); ty += 25; });
  if (t.d.length) { ty += 6; t.d.forEach((s) => { c.out.push(`<text x="${cx}" y="${ty + 8}" font-size="15" text-anchor="middle" fill="${col}" fill-opacity=".74" font-family="${c.font}" dominant-baseline="middle">${esc(s)}</text>`); ty += 18; }); }
}
const rectEdge = (cx: number, cy: number, w: number, h: number, tx: number, ty: number, pad = 5): [number, number] => {
  const dx = tx - cx, dy = ty - cy; if (!dx && !dy) return [cx, cy]; const t = 1 / Math.max(Math.abs(dx) / (w / 2 + pad), Math.abs(dy) / (h / 2 + pad)); return [cx + dx * t, cy + dy * t];
};
function arrow(c: C, x1: number, y1: number, x2: number, y2: number, bend = 0, dashed = false, head = true) {
  const mx = (x1 + x2) / 2 + bend * (y2 - y1) * 0.25, my = (y1 + y2) / 2 - bend * (x2 - x1) * 0.25, ang = Math.atan2(y2 - my, x2 - mx), L = 13, col = stroke(c), sw = c.theme === "notebook" ? 2.6 : 2;
  const line = `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" ${dashed ? 'stroke-dasharray="6 6"' : ""}/>`;
  if (!head) { c.out.push(line); return; }
  const a = [0.45, -0.45].map((s) => `${(x2 - Math.cos(ang + s) * L).toFixed(1)} ${(y2 - Math.sin(ang + s) * L).toFixed(1)}`);
  c.out.push(line + (c.theme === "notebook" || c.theme === "mono" ? `<path d="M${a[0]}L${x2.toFixed(1)} ${y2.toFixed(1)}L${a[1]}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${a[0]}L${x2.toFixed(1)} ${y2.toFixed(1)}L${a[1]}Z" fill="${col}" stroke="${col}" stroke-width="1" stroke-linejoin="round"/>`));
}
const badge = (c: C, x: number, y: number, k: number) => c.out.push(c.theme === "bold"
  ? `<circle cx="${x}" cy="${y}" r="14" fill="#fff"/><text x="${x}" y="${y + 1}" font-size="16" text-anchor="middle" dominant-baseline="middle" fill="${INK}" font-family="${c.font}" font-weight="700">${k}</text>`
  : `<circle cx="${x}" cy="${y}" r="14" fill="${c.theme === "notebook" ? "#FFE45C" : c.pal.accent}" stroke="${c.theme === "notebook" || c.theme === "mono" ? INK : "none"}" stroke-width="2"/><text x="${x}" y="${y + 1}" font-size="16" text-anchor="middle" dominant-baseline="middle" fill="${c.theme === "notebook" ? INK : "#fff"}" font-family="${c.font}" font-weight="${c.theme === "notebook" ? 400 : 700}">${k}</text>`);

type Box = { w: number; h: number; ox?: number; oy?: number };
function process(c: C, nodes: VNode[]): Box {
  const n = nodes.length, per = n <= 4 ? n : n <= 6 ? 3 : 4, cw = 188, gx = 62, gy = 64, { h } = cardSize(c, nodes, cw), pos: [number, number][] = [];
  nodes.forEach((_, i) => { const r = Math.floor(i / per); let col = i % per; if (r % 2) col = per - 1 - col; pos.push([col * (cw + gx), r * (h + gy)]); });
  nodes.forEach((_, i) => { if (!i) return; const [x1, y1] = pos[i - 1], [x2, y2] = pos[i]; if (y1 === y2) { const l = x2 > x1; arrow(c, l ? x1 + cw + 5 : x1 - 5, y1 + h / 2, l ? x2 - 5 : x2 + cw + 5, y2 + h / 2); } else arrow(c, x1 + cw / 2, y1 + h + 5, x2 + cw / 2, y2 - 5); });
  nodes.forEach((nd, i) => { card(c, nd, pos[i][0], pos[i][1], cw, h, i); badge(c, pos[i][0] + 6, pos[i][1] + 4, i + 1); });
  return { w: per * cw + (per - 1) * gx, h: Math.ceil(n / per) * h + (Math.ceil(n / per) - 1) * gy };
}
function cycle(c: C, nodes: VNode[], title: string): Box {
  const n = nodes.length; if (n < 3) return process(c, nodes);
  const cw = 176, { h } = cardSize(c, nodes, cw), R = Math.max(150, (Math.max(cw, h) + 38) / (2 * Math.sin(Math.PI / n))), rx = R * 1.3, ry = R, cx = rx + cw / 2, cy = ry + h / 2;
  const P = nodes.map((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  nodes.forEach((_, i) => { const [ax, ay] = P[i], [bx, by] = P[(i + 1) % n], mx = (ax + bx) / 2, my = (ay + by) / 2, ox = mx - cx, oy = my - cy, d = Math.hypot(ox, oy) || 1, kx = mx + (ox / d) * 34, ky = my + (oy / d) * 34;
    const [x1, y1] = rectEdge(ax, ay, cw, h, kx, ky), [x2, y2] = rectEdge(bx, by, cw, h, kx, ky); arrowQ(c, x1, y1, kx, ky, x2, y2); });
  nodes.forEach((nd, i) => card(c, nd, P[i][0] - cw / 2, P[i][1] - h / 2, cw, h, i));
  const tl = wrap(c, title, 190, 26); tl.forEach((s, i) => c.out.push(`<text x="${cx}" y="${cy + (i - (tl.length - 1) / 2) * 30}" font-size="26" text-anchor="middle" dominant-baseline="middle" fill="${INK}" fill-opacity=".8" font-family="${c.font}" font-weight="${c.theme === "clean" || c.theme === "bold" ? 700 : 400}">${esc(s)}</text>`));
  return { w: 2 * rx + cw, h: 2 * ry + h };
}
function arrowQ(c: C, x1: number, y1: number, kx: number, ky: number, x2: number, y2: number) {
  const ang = Math.atan2(y2 - ky, x2 - kx), L = 13, col = stroke(c), sw = c.theme === "notebook" ? 2.6 : 2, a = [0.45, -0.45].map((s) => `${(x2 - Math.cos(ang + s) * L).toFixed(1)} ${(y2 - Math.sin(ang + s) * L).toFixed(1)}`);
  c.out.push(`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}Q${kx.toFixed(1)} ${ky.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>` +
    (c.theme === "notebook" || c.theme === "mono" ? `<path d="M${a[0]}L${x2.toFixed(1)} ${y2.toFixed(1)}L${a[1]}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${a[0]}L${x2.toFixed(1)} ${y2.toFixed(1)}L${a[1]}Z" fill="${col}" stroke="${col}" stroke-linejoin="round"/>`));
}
function hierarchy(c: C, nodes: VNode[]): Box {
  const byId = new Map(nodes.map((n) => [n.id, n])), kids = new Map<string, VNode[]>(); nodes.forEach((n) => kids.set(n.id, []));
  const root = nodes[0]; nodes.slice(1).forEach((n) => { const p = n.parent && byId.has(n.parent) && n.parent !== n.id ? n.parent : root.id; kids.get(p)!.push(n); });
  const cw = 168, { h } = cardSize(c, nodes, cw), gx = 26, gy = 56;
  const widths = new Map<string, number>(); const calc = (n: VNode, st = new Set<string>()): number => { if (st.has(n.id)) return cw + gx; st.add(n.id); const k = kids.get(n.id)!; const w = Math.max(cw + gx, k.reduce((s, x) => s + calc(x, st), 0)); widths.set(n.id, w); return w; };
  const total = calc(root); let maxDepth = 0; const idx = new Map(nodes.map((n, i) => [n.id, i])), placed = new Set<string>();
  const place = (n: VNode, left: number, depth: number): number => { placed.add(n.id); maxDepth = Math.max(maxDepth, depth); const w = widths.get(n.id) || cw + gx, cx = left + w / 2, y = depth * (h + gy); let kl = left; const k = kids.get(n.id)!.filter((x) => !placed.has(x.id)), centers: number[] = [];
    k.forEach((ch) => { const cwid = widths.get(ch.id) || cw + gx; centers.push(kl + cwid / 2); place(ch, kl, depth + 1); kl += cwid; });
    if (k.length) { const midY = y + h + gy / 2; c.out.push(`<path d="M${cx} ${y + h + 4}V${midY}${centers.length > 1 ? `M${centers[0]} ${midY}H${centers[centers.length - 1]}` : ""}${centers.map((x) => `M${x} ${midY}V${y + h + gy - 4}`).join("")}" fill="none" stroke="${stroke(c)}" stroke-width="${c.theme === "notebook" ? 2.6 : 2}" stroke-linecap="round"/>`); }
    card(c, n, cx - cw / 2, y, cw, h, idx.get(n.id) || 0, "center", depth === 0); return w; };
  place(root, 0, 0); return { w: total - gx, h: (maxDepth + 1) * h + maxDepth * gy, ox: -gx / 2 };
}
function mindmap(c: C, nodes: VNode[]): Box {
  const root = nodes[0], rest = nodes.slice(1), ids = new Set(nodes.map((n) => n.id)), first = rest.filter((n) => !n.parent || !ids.has(n.parent) || n.parent === root.id), cw = 168, { h } = cardSize(c, nodes, cw), pos = new Map<string, [number, number, number]>();
  const R1 = Math.max(230, (first.length * (cw * 0.62 + 30)) / (2 * Math.PI)), idx = new Map(nodes.map((n, i) => [n.id, i]));
  first.forEach((n, i) => { const off = first.length % 2 === 0 ? 0.5 : 0, a = -Math.PI / 2 + (2 * Math.PI * (i + off)) / Math.max(1, first.length); pos.set(n.id, [Math.cos(a) * R1 * 1.45, Math.sin(a) * R1, a]); });
  first.forEach((p) => { const sub = rest.filter((n) => n.parent === p.id); const [px, py, a] = pos.get(p.id)!; sub.forEach((n, i) => { const spread = 0.62, aa = a + (sub.length === 1 ? 0 : (i / (sub.length - 1) - 0.5) * spread * 2); pos.set(n.id, [px + Math.cos(aa) * (cw + 110), py + Math.sin(aa) * (h + 80), aa]); }); });
  rest.forEach((n) => { if (!pos.has(n.id)) pos.set(n.id, [0, 0, 0]); });
  const rw = 214, rh = h + 14;
  rest.forEach((n) => { const [x, y] = pos.get(n.id)!; const par = n.parent && pos.has(n.parent) && n.parent !== root.id ? pos.get(n.parent)! : [0, 0, 0], pw = n.parent && pos.has(n.parent) && n.parent !== root.id ? cw : rw, ph = n.parent && pos.has(n.parent) && n.parent !== root.id ? h : rh;
    const [x1, y1] = rectEdge(par[0], par[1], pw, ph, x, y), [x2, y2] = rectEdge(x, y, cw, h, par[0], par[1]); arrow(c, x1, y1, x2, y2, 0.35, false, false); });
  rest.forEach((n) => { const [x, y] = pos.get(n.id)!; const top = first.findIndex((f) => f.id === n.id), pi = top >= 0 ? idx.get(n.id)! : idx.get(n.parent!) ?? 1; card(c, n, x - cw / 2, y - h / 2, cw, h, pi); });
  card(c, root, -rw / 2, -rh / 2, rw, rh, 0, "center", true);
  let x0 = -rw / 2, y0 = -rh / 2, x1 = rw / 2, y1 = rh / 2; pos.forEach(([x, y]) => { x0 = Math.min(x0, x - cw / 2); x1 = Math.max(x1, x + cw / 2); y0 = Math.min(y0, y - h / 2); y1 = Math.max(y1, y + h / 2); });
  return { w: x1 - x0, h: y1 - y0, ox: -x0, oy: -y0 };
}
function comparison(c: C, nodes: VNode[]): Box {
  let groups = [...new Set(nodes.map((n) => n.group).filter(Boolean) as string[])]; const cols: VNode[][] = [];
  if (groups.length >= 2) { groups = groups.slice(0, 4); groups.forEach(() => cols.push([])); let last = 0; nodes.forEach((n) => { const g = groups.indexOf(n.group || ""); if (g >= 0) last = g; cols[g >= 0 ? g : last].push(n); }); }
  else { groups = ["", ""]; const half = Math.ceil(nodes.length / 2); cols.push(nodes.slice(0, half), nodes.slice(half)); }
  const cw = 236, gx = groups.length === 2 ? 74 : 34, { h } = cardSize(c, nodes, cw), hh = groups[0] ? 54 : 0; let k = 0;
  cols.forEach((col, ci) => { const x = ci * (cw + gx); if (hh) { const solid = c.pal.solid[ci % c.pal.solid.length]; c.out.push(c.theme === "notebook" ? `<rect x="${x}" y="0" width="${cw}" height="${hh - 8}" rx="10" fill="${c.pal.light[ci % c.pal.light.length]}" stroke="${INK}" stroke-width="2.5"/>` : c.theme === "mono" ? `<rect x="${x}" y="0" width="${cw}" height="${hh - 8}" rx="6" fill="#fff" stroke="${INK}" stroke-width="2.4"/>` : `<rect x="${x}" y="0" width="${cw}" height="${hh - 8}" rx="12" fill="${solid}"/>`);
      c.out.push(`<text x="${x + cw / 2}" y="${(hh - 8) / 2 + 1}" font-size="24" text-anchor="middle" dominant-baseline="middle" fill="${c.theme === "bold" || c.theme === "clean" ? "#fff" : INK}" font-family="${c.font}" font-weight="${c.theme === "clean" || c.theme === "bold" ? 700 : 400}">${esc(groups[ci])}</text>`); }
    col.forEach((nd, r) => card(c, nd, x, hh + r * (h + 18), cw, h, k++)); });
  if (groups.length === 2) { const mx = cw + gx / 2; c.out.push(`<circle cx="${mx}" cy="${hh ? (hh - 8) / 2 : h / 2}" r="22" fill="${c.theme === "notebook" ? "#FFE45C" : c.pal.accent}" stroke="${c.theme === "notebook" || c.theme === "mono" ? INK : "none"}" stroke-width="2.2"/><text x="${mx}" y="${(hh ? (hh - 8) / 2 : h / 2) + 1}" font-size="19" text-anchor="middle" dominant-baseline="middle" fill="${c.theme === "notebook" ? INK : "#fff"}" font-family="${c.font}" font-weight="700">VS</text>`); }
  const maxRows = Math.max(...cols.map((x) => x.length)); return { w: cols.length * cw + (cols.length - 1) * gx, h: hh + maxRows * (h + 18) - 18 };
}
function timeline(c: C, nodes: VNode[]): Box {
  const n = nodes.length, cw = 186, step = cw + 26, { h } = cardSize(c, nodes, cw), stub = 46, axisY = h + stub + 14, W = (n - 1) * step + cw;
  c.out.push(`<path d="M0 ${axisY}H${W + 22}" stroke="${stroke(c)}" stroke-width="${c.theme === "notebook" ? 3 : 2.4}" stroke-linecap="round" fill="none"/>`);
  nodes.forEach((nd, i) => { const cx = i * step + cw / 2, up = i % 2 === 0, y = up ? 0 : axisY + 14 + stub; c.out.push(`<path d="M${cx} ${up ? h + 4 : axisY + 14}V${up ? axisY - 14 : y - 4}" stroke="${stroke(c)}" stroke-width="2" stroke-dasharray="4 5" fill="none"/>`); card(c, nd, i * step, y, cw, h, i); badge(c, cx, axisY, i + 1); });
  return { w: W + 22, h: axisY + 14 + stub + h };
}
function list(c: C, nodes: VNode[]): Box {
  const n = nodes.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, cw = 276, gx = 22, gy = 20, { h } = cardSize(c, nodes, cw, "left");
  nodes.forEach((nd, i) => card(c, nd, (i % cols) * (cw + gx), Math.floor(i / cols) * (h + gy), cw, h, i, "left"));
  const rows = Math.ceil(n / cols); return { w: cols * cw + (cols - 1) * gx, h: rows * h + (rows - 1) * gy };
}

export function renderVisual(spec: VSpec, kind: string, theme: ThemeId, palette: Palette, showTitle = false): Rendered {
  const c: C = { theme, pal: palette, font: FONTS[theme], cw: theme === "clean" || theme === "bold" ? 0.56 : 0.48, out: [], hand: theme === "notebook" };
  const nodes = spec.nodes.filter((n) => n.label.trim()).slice(0, 12); if (!nodes.length) return { svg: "", w: 0, h: 0 };
  const box = ({ process, cycle: (cc: C, nn: VNode[]) => cycle(cc, nn, spec.title), hierarchy, mindmap, comparison, timeline, list } as any)[kind]?.(c, nodes) || list(c, nodes);
  const pad = 22, titleH = showTitle && kind !== "cycle" ? 54 : 0, ox = (box.ox || 0) + pad, oy = (box.oy || 0) + pad + titleH, W = Math.ceil(box.w + pad * 2), H = Math.ceil(box.h + pad * 2 + titleH);
  const head = titleH ? `<text x="${W / 2}" y="${pad + 22}" font-size="30" text-anchor="middle" fill="${INK}" font-family="${c.font}" font-weight="${theme === "clean" || theme === "bold" ? 700 : 400}">${esc(spec.title)}</text>` : "";
  const defs = theme === "clean" ? `<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1b2540" flood-opacity=".14"/></filter></defs>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}${head}<g transform="translate(${ox} ${oy})">${c.out.join("")}</g></svg>`;
  return { svg, w: W, h: H };
}
export const toDataUri = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
export const altFor = (spec: VSpec) => `${spec.title}: ${spec.nodes.map((n) => n.label).join(" → ")}`.slice(0, 300);
