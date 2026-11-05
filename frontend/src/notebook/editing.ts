export type Obj = { id: string; kind: "image" | "visual"; src: string; alt: string; x: number; y: number; w: number; h: number; meta?: any };
export type Sheet = { id: string; html: string; objects: Obj[] };
export const PAGE_W = 794, PAGE_H = 1123;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const blankSheet = (html = "<p><br></p>"): Sheet => ({ id: uid(), html, objects: [] });
export const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const textToHtml = (t: string) => t.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escHtml(l)}</p>`).join("") || "<p><br></p>";

/** Notes are the person's own content, but pasted/loaded HTML must never run script: strip active content and event handlers. */
export function sanitize(html: string): string {
  const t = document.createElement("template"); t.innerHTML = html || "";
  t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select").forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith("on") || ((n === "href" || n === "src" || n === "xlink:href") && v.startsWith("javascript:"))) el.removeAttribute(a.name);
    }
  });
  return t.innerHTML;
}

const sel = () => window.getSelection()!;
export function useStyleCss(on: boolean) { try { document.execCommand("styleWithCSS", false, on ? "true" : "false"); } catch {} }

export function applyFontSize(ed: HTMLElement, px: number) {
  useStyleCss(false); document.execCommand("fontSize", false, "7");
  ed.querySelectorAll('font[size="7"]').forEach((f) => {
    const s = document.createElement("span"); s.style.fontSize = px + "px"; s.style.lineHeight = "1.45";
    while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s);
    s.querySelectorAll<HTMLElement>("[style*='font-size']").forEach((c) => { c.style.fontSize = ""; if (!c.getAttribute("style")?.trim()) c.removeAttribute("style"); });
  });
  useStyleCss(true);
}
export function applyColor(kind: "foreColor" | "hiliteColor", color: string) { useStyleCss(true); document.execCommand(kind, false, color); }
export function currentFontSize(range: Range | null, fallback = 20) {
  if (!range) return fallback; let n: Node | null = range.startContainer; if (n.nodeType === 3) n = n.parentElement;
  const px = parseFloat(getComputedStyle(n as Element).fontSize); return Number.isFinite(px) ? Math.round(px) : fallback;
}
export function caretToEnd(el: HTMLElement) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = sel(); s.removeAllRanges(); s.addRange(r); }

/** Reads an image file. Big photos are shrunk (max 1600px) so notes stay quick to save. */
export async function readImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const raw: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error("Couldn't read that image.")); r.readAsDataURL(file); });
  const img: HTMLImageElement = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image the browser can open.")); i.src = raw; });
  const nw = img.naturalWidth || 400, nh = img.naturalHeight || 300;
  if (file.type === "image/svg+xml" || (file.size < 700_000 && Math.max(nw, nh) <= 1600)) return { src: raw, w: nw, h: nh };
  const k = Math.min(1, 1600 / Math.max(nw, nh)), c = document.createElement("canvas"); c.width = Math.round(nw * k); c.height = Math.round(nh * k);
  const g = c.getContext("2d")!; if (file.type !== "image/png") { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); } g.drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86), w: c.width, h: c.height };
}

// ------------------------------------------------------------------ structured blocks (compose / organize) and Companion note boxes
export type Block = { type: "heading" | "subheading" | "paragraph" | "bullets" | "numbered" | "keep" | "visual" | "question" | "code"; text?: string; tag?: string; items?: string[]; ref?: string; lang?: string };
/** Loose text key used to recognise a line the AI copied unchanged (so its original formatting can be kept). */
export const textKey = (s: string) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isTag = (n: Node) => n.nodeType === 1 && (n as HTMLElement).style.float === "right";
/** A heading's own text, without the small side label compose puts on the right. */
export const headingText = (h: Element) => Array.from(h.childNodes).filter((n) => !isTag(n)).map((n) => n.textContent || "").join("").replace(/\s+/g, " ").trim();
export const headingTag = (h: Element) => (Array.from(h.childNodes).find(isTag)?.textContent || "").trim();
/** Replace a heading's text but keep its side label and, when the text sits in one styled wrapper, that styling. */
export function setHeadingText(h: Element, text: string) {
  const own = Array.from(h.childNodes).filter((n) => !isTag(n) && !(n.nodeType === 3 && !(n.textContent || "").trim()));
  if (own.length === 1 && own[0].nodeType === 1 && !(own[0] as Element).querySelector("br")) { own[0].textContent = text; return; }
  const tag = Array.from(h.childNodes).find(isTag) || null; Array.from(h.childNodes).forEach((n) => { if (n !== tag) n.remove(); }); h.insertBefore(document.createTextNode(text), tag);
}
export const isNoteBox = (n: Node) => n.nodeType === 1 && (n as Element).matches("blockquote.ai-note,[data-ai-note]");
export const noteBoxHtml = (label: string, inner: string) =>
  `<blockquote class="ai-note" data-ai-note="1" style="font-size:16px;line-height:1.45;color:#3b3b4f;background:#f4f1ff;border-left:4px solid #7048e8;border-radius:8px;padding:8px 14px;margin:12px 0">` +
  `<p style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7048e8;margin:0 0 4px">✦ ${escHtml(label)}</p>${inner}</blockquote>`;

const headingHtml = (text: string, tag?: string, sub = false) => `<h2${sub ? ' style="font-size:26px"' : ""}>${escHtml(text)}${tag ? `<span style="float:right;font-size:17px;font-weight:400;color:#6b6b6b;margin-top:.5em">${escHtml(tag)}</span>` : ""}</h2>`;
export type Reuse = { orig: Map<string, string>; boxes: { html: string; sheet: number }[]; used: Set<number> };
/** Blocks -> sheet HTML. With `reuse`, lines that come back unchanged keep their original HTML (colours, highlights, bold) and [[box N]] refs restore the saved boxes. */
export function blocksToHtml(blocks: Block[], reuse?: Reuse) {
  const li = (items: string[] = []) => items.map((x) => `<li>${reuse?.orig.get("li:" + textKey(x)) ?? escHtml(x)}</li>`).join("");
  return blocks.map((b) => {
    if (b.type === "keep") { const n = Number((b.ref || "").replace(/\D+/g, "")) - 1, box = reuse?.boxes[n]; if (!box || reuse!.used.has(n)) return ""; reuse!.used.add(n); return box.html; }
    if (b.type === "heading" || b.type === "subheading") return reuse?.orig.get("h:" + textKey(b.text || "") + "|" + textKey(b.tag || "")) ?? headingHtml(b.text || "", b.type === "heading" ? b.tag : "", b.type === "subheading");
    if (b.type === "paragraph") return reuse?.orig.get("p:" + textKey(b.text || "")) ?? `<p>${escHtml(b.text || "")}</p>`;
    if (b.type === "question") return `<p class="q"><b>${escHtml(b.text || "")}</b></p>`;
    if (b.type === "code") return `<pre class="code" data-lang="${escHtml(b.lang || "")}"><code>${escHtml(b.text || "")}</code></pre>`;
    if (b.type === "bullets") return `<ul>${li(b.items)}</ul>`;
    if (b.type === "numbered") return `<ol>${li(b.items)}</ol>`;
    return "";
  }).join("");
}
/** Sheet HTML -> the plain outline the organizer reads. Fills `reuse` so the result can keep untouched lines and boxes. */
export function sheetOutline(html: string, sheet: number, reuse: Reuse) {
  const t = document.createElement("template"); t.innerHTML = sanitize(html); const lines: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { const x = (n.textContent || "").replace(/\s+/g, " ").trim(); if (x) lines.push(x); return; }
    if (n.nodeType !== 1) return; const el = n as HTMLElement, tg = el.tagName.toLowerCase();
    if (isNoteBox(el) || tg === "pre") { reuse.boxes.push({ html: el.outerHTML, sheet }); lines.push(`[[box ${reuse.boxes.length}]]`); return; }
    if (/^h[1-6]$/.test(tg)) { const h = headingText(el), g = headingTag(el); if (!h && !g) return; reuse.orig.set("h:" + textKey(h) + "|" + textKey(g), el.outerHTML); lines.push("## " + h + (g ? ` {tag: ${g}}` : "")); return; }
    if (tg === "ul" || tg === "ol") { Array.from(el.children).forEach((c, i) => { const x = (c.textContent || "").replace(/\s+/g, " ").trim(); if (!x) return; reuse.orig.set("li:" + textKey(x), (c as HTMLElement).innerHTML); lines.push((tg === "ol" ? `${i + 1}. ` : "- ") + x); }); return; }
    if (el.querySelector("p,div,ul,ol,h1,h2,h3,h4,blockquote")) { Array.from(el.childNodes).forEach(walk); return; }
    const x = (el.textContent || "").replace(/\s+/g, " ").trim(); if (!x) return; reuse.orig.set("p:" + textKey(x), tg === "p" ? el.outerHTML : `<p>${el.innerHTML}</p>`); lines.push(x);
  };
  Array.from(t.content.childNodes).forEach(walk); return lines.join("\n");
}
/** The Companion's light markdown (bullets, numbers, **bold**, # headings) -> HTML for a note box. */
export function mdToHtml(md: string) {
  const inl = (s: string) => escHtml(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "$1");
  let out = "", list = ""; const close = () => { if (list) { out += `</${list}>`; list = ""; } };
  for (const raw of (md || "").replace(/\[note:\d+\]/g, "").split(/\r?\n/)) {
    const l = raw.trim(); let m: RegExpMatchArray | null; if (!l) { close(); continue; }
    if ((m = l.match(/^[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out += "<ul>"; list = "ul"; } out += `<li>${inl(m[1])}</li>`; }
    else if ((m = l.match(/^\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out += "<ol>"; list = "ol"; } out += `<li>${inl(m[1])}</li>`; }
    else { close(); const h = l.match(/^#{1,6}\s+(.*)/); out += h ? `<p><b>${inl(h[1])}</b></p>` : `<p>${inl(l)}</p>`; }
  }
  close(); return out || "<p><br></p>";
}
/** Spread blocks over sheets like pages: a new sheet before a heading once the sheet is half full, or when it is full. */
export function groupIntoSheets(blocks: Block[], max = 1500): string[] {
  const out: string[] = []; let cur: Block[] = [], size = 0;
  for (const b of blocks) {
    const n = b.type === "code" ? (b.text || "").split("\n").length * 45 + 60 : (b.text || "").length + (b.items || []).join(" ").length + 40, head = b.type === "heading" || b.type === "subheading" || b.type === "question";
    if (cur.length && (size + n > max || (head && size > max * 0.55))) { out.push(blocksToHtml(cur)); cur = []; size = 0; }
    cur.push(b); size += n;
  }
  if (cur.length) out.push(blocksToHtml(cur));
  return out;
}
