/** Export a notebook as Markdown, Word (.docx) or PDF, entirely in the browser (nothing is uploaded). */
import { Obj, PAGE_H, PAGE_W, Sheet, sanitize } from "./editing";

const fileName = (t: string, ext: string) => ((t || "notebook").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "notebook") + "." + ext;
export function download(blob: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const doc = (html: string) => new DOMParser().parseFromString(`<body>${sanitize(html)}</body>`, "text/html").body;

/** PNG data URL of an image object. SVG visuals and WebP are drawn onto a canvas, because Word and most Markdown viewers can't show those. */
export async function rasterize(src: string, w: number, h: number, scale = 2): Promise<string> {
  if (/^data:image\/(png|jpeg|jpg);/.test(src)) return src;
  const img = new Image(); img.decoding = "sync";
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("An image on this notebook couldn't be converted.")); img.src = src; });
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/png");
}
const ordered = (s: Sheet) => [...s.objects].sort((a, b) => a.y - b.y || a.x - b.x);

// ------------------------------------------------------------------ Markdown
export async function exportMarkdown(title: string, sheets: Sheet[]) {
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent || "").replace(/\s+/g, " ").replace(/([*_`\[\]])/g, "\\$1");
    if (n.nodeType !== 1) return "";
    const el = n as HTMLElement, t = el.tagName.toLowerCase(), inner = Array.from(el.childNodes).map(inline).join("");
    if (t === "br") return "  \n"; if (!inner.trim()) return inner;
    if (t === "b" || t === "strong" || (el.style.fontWeight && +el.style.fontWeight >= 600)) return `**${inner.trim()}**`;
    if (t === "i" || t === "em") return `*${inner.trim()}*`; if (t === "u") return `<u>${inner}</u>`; return inner;
  };
  const block = (n: Node, out: string[]) => {
    if (n.nodeType === 3) { const t = (n.textContent || "").trim(); if (t) out.push(inline(n).trim()); return; }
    if (n.nodeType !== 1) return; const el = n as HTMLElement, t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) { out.push("## " + inline(el).trim()); return; }
    if (t === "pre") { out.push("```" + (el.getAttribute("data-lang") || "") + "\n" + (el.textContent || "").replace(/\n$/, "") + "\n```"); return; }
    if (t === "ul" || t === "ol") { out.push(Array.from(el.children).map((li, i) => (t === "ol" ? `${i + 1}. ` : "- ") + inline(li).trim()).join("\n")); return; }
    if (t === "blockquote" && el.querySelector("p,div,ul,ol,h1,h2,h3")) { const sub: string[] = []; Array.from(el.childNodes).forEach((c) => block(c, sub)); if (sub.length) out.push(sub.join("\n\n").split("\n").map((l) => "> " + l).join("\n")); return; }
    if (t === "p" || t === "div" || t === "blockquote") { if (el.querySelector("p,div,ul,ol,h1,h2,h3")) Array.from(el.childNodes).forEach((c) => block(c, out)); else { const x = inline(el).trim(); if (x) out.push((t === "blockquote" ? "> " : "") + x); } return; }
    const x = inline(el).trim(); if (x) out.push(x);
  };
  const parts: string[] = [`# ${title || "Notebook"}`];
  for (let i = 0; i < sheets.length; i++) {
    const out: string[] = []; Array.from(doc(sheets[i].html).childNodes).forEach((c) => block(c, out));
    for (const o of ordered(sheets[i])) out.push(`![${o.alt.replace(/[\[\]\n]/g, " ")}](${await rasterize(o.src, o.w, o.h)})`);
    parts.push((sheets.length > 1 ? `<!-- Sheet ${i + 1} -->\n` : "") + (out.join("\n\n") || "*(empty sheet)*"));
  }
  download(new Blob([parts[0] + "\n\n" + parts.slice(1).join("\n\n---\n\n") + "\n"], { type: "text/markdown;charset=utf-8" }), fileName(title, "md"));
}

// ------------------------------------------------------------------ Word
const hex = (c: string) => { const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase(); const h = c.replace("#", ""); return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : /^[0-9a-f]{3}$/i.test(h) ? h.split("").map((x) => x + x).join("").toUpperCase() : undefined; };
export async function exportDocx(title: string, sheets: Sheet[]) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, LevelFormat, AlignmentType, ShadingType } = await import("docx");
  type St = { b?: boolean; i?: boolean; u?: boolean; color?: string; size?: number; fill?: string };
  const runs = (n: Node, st: St): any[] => {
    if (n.nodeType === 3) { const t = (n.textContent || "").replace(/\s+/g, " "); return t ? [new TextRun({ text: t, bold: st.b, italics: st.i, underline: st.u ? {} : undefined, color: st.color, size: st.size, shading: st.fill ? { type: ShadingType.CLEAR, fill: st.fill, color: "auto" } : undefined })] : []; }
    if (n.nodeType !== 1) return []; const el = n as HTMLElement, t = el.tagName.toLowerCase();
    if (t === "br") return [new TextRun({ break: 1 })];
    const s: St = { ...st }; if (t === "b" || t === "strong") s.b = true; if (t === "i" || t === "em") s.i = true; if (t === "u") s.u = true;
    if (t === "font" && el.getAttribute("color")) s.color = hex(el.getAttribute("color")!) || s.color;
    if (el.style.fontWeight && +el.style.fontWeight >= 600) s.b = true; if (el.style.color) s.color = hex(el.style.color) || s.color;
    const bg = el.style.backgroundColor; if (bg && bg !== "transparent") s.fill = hex(bg) || s.fill;
    const px = parseFloat(el.style.fontSize || ""); if (px) s.size = Math.round(px * 1.5);
    return Array.from(el.childNodes).flatMap((c) => runs(c, s));
  };
  const children: any[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title || "Notebook")] })]; let olN = 0;
  const block = (n: Node) => {
    if (n.nodeType === 3) { const r = runs(n, {}); if ((n.textContent || "").trim()) children.push(new Paragraph({ children: r })); return; }
    if (n.nodeType !== 1) return; const el = n as HTMLElement, t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(el, {}) })); return; }
    if (t === "pre") { (el.textContent || "").replace(/\n$/, "").split("\n").forEach((line) => children.push(new Paragraph({ spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: "F6F8FA", color: "auto" }, children: [new TextRun({ text: line || " ", font: "Consolas", size: 19 })] }))); children.push(new Paragraph({ children: [] })); return; }
    if (t === "ul" || t === "ol") { const inst = ++olN; Array.from(el.children).forEach((li) => children.push(new Paragraph({ children: runs(li, {}), ...(t === "ul" ? { bullet: { level: 0 } } : { numbering: { reference: "num", level: 0, instance: inst } }) }))); return; }
    if ((t === "div" || t === "blockquote") && el.querySelector("p,div,ul,ol,h1,h2,h3")) { Array.from(el.childNodes).forEach(block); return; }
    const r = runs(el, {}); if (r.length) children.push(new Paragraph({ children: r, spacing: { after: 120 } }));
  };
  for (let i = 0; i < sheets.length; i++) {
    const before = children.length; Array.from(doc(sheets[i].html).childNodes).forEach(block);
    for (const o of ordered(sheets[i])) {
      const url = await rasterize(o.src, o.w, o.h), w = Math.min(o.w, 600), h = Math.round((w * o.h) / o.w), bin = atob(url.split(",")[1]), data = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) data[k] = bin.charCodeAt(k);
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 }, children: [new ImageRun({ data, transformation: { width: w, height: h }, altText: { title: o.alt.slice(0, 80), description: o.alt, name: "figure" } })] }));
    }
    if (i < sheets.length - 1) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    else if (children.length === before) children.push(new Paragraph({ children: [] }));
  }
  const d = new Document({ styles: { default: { document: { run: { font: "Calibri", size: 24 } } } }, numbering: { config: [{ reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT }] }] }, sections: [{ children }] });
  download(await Packer.toBlob(d), fileName(title, "docx"));
}

// ------------------------------------------------------------------ PDF
export async function exportPdf(title: string, sheets: Sheet[], onProgress?: (i: number, n: number) => void) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const host = document.createElement("div"); host.setAttribute("aria-hidden", "true"); host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;pointer-events:none`;
  host.innerHTML = sheets.map((s) => `<div class="pdf-page" style="position:relative;width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;overflow:hidden"><div class="page-editor" style="overflow:hidden">${sanitize(s.html)}</div>${s.objects.map((o: Obj) => `<img src="${o.src}" alt="" style="position:absolute;left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px">`).join("")}</div>`).join("");
  document.body.appendChild(host);
  try {
    await Promise.all(Array.from(host.querySelectorAll("img")).map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = () => r(null); }))));
    if ((document as any).fonts?.ready) await (document as any).fonts.ready;
    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true }), pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const pages = Array.from(host.querySelectorAll<HTMLElement>(".pdf-page"));
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i + 1, pages.length); const c = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      if (i) pdf.addPage(); pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, ph, undefined, "FAST");
    }
    pdf.setProperties({ title: title || "Notebook" }); download(pdf.output("blob"), fileName(title, "pdf"));
  } finally { host.remove(); }
}
