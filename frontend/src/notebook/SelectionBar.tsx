import { useEffect, useRef, useState } from "react";
import { applyColor, applyFontSize, currentFontSize } from "./editing";
const COLORS = ["#2B2B2B", "#E03131", "#E8590C", "#F2B705", "#2F9E44", "#1C7ED6", "#3B5BDB", "#7048E8", "#D6336C", "#868E96"];
const MARKS = ["#FFE45C", "#FFD0C2", "#C9F2DD", "#BFD4FF", "#D9D2FF", "#FFC9D6", "transparent"];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
type P = { ed: React.RefObject<HTMLDivElement>; onChange: () => void; onVisualize: (text: string) => void; onAsk: (text: string) => void; onRead: (text: string) => void; reading: boolean; readIn?: { label: string; go: (text: string) => void } };
/** Word-style mini toolbar that floats above the selected text. */
export default function SelectionBar({ ed, onChange, onVisualize, onAsk, onRead, reading, readIn }: P) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null), [open, setOpen] = useState<"" | "size" | "color" | "mark">(""), [size, setSize] = useState(20);
  const saved = useRef<Range | null>(null), bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const s = window.getSelection(); const el = ed.current;
      if (!s || !el || !s.rangeCount || s.isCollapsed || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) { if (!bar.current?.contains(document.activeElement)) { setPos(null); setOpen(""); } return; }
      const r = s.getRangeAt(0); saved.current = r.cloneRange(); setSize(currentFontSize(r)); const b = r.getBoundingClientRect(); if (!b.width && !b.height) return;
      const w = bar.current?.offsetWidth || 470; let x = Math.min(Math.max(8, b.left + b.width / 2 - w / 2), window.innerWidth - w - 8), y = b.top - 54; if (y < 8) y = b.bottom + 12; setPos({ x, y });
    };
    document.addEventListener("selectionchange", update); window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    return () => { document.removeEventListener("selectionchange", update); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [ed]);
  const run = (fn: () => void) => { const el = ed.current; if (!el) return; el.focus(); const s = window.getSelection()!; if (saved.current) { s.removeAllRanges(); s.addRange(saved.current); } fn(); if (s.rangeCount) saved.current = s.getRangeAt(0).cloneRange(); onChange(); };
  const text = () => (saved.current?.toString() || "").trim();
  const keep = (e: React.MouseEvent) => e.preventDefault();
  if (!pos) return null;
  return <div ref={bar} className="selbar" style={{ left: pos.x, top: pos.y }} onMouseDown={keep} role="toolbar" aria-label="Text options">
    <div className="selbar-group">
      <button className="sb-btn wide" onClick={() => setOpen(open === "size" ? "" : "size")} aria-haspopup="listbox" title="Font size">{size}<span className="caret">▾</span></button>
      <button className="sb-btn" onClick={() => { const n = Math.max(8, size - 2); run(() => applyFontSize(ed.current!, n)); setSize(n); }} title="Smaller" aria-label="Smaller text">A−</button>
      <button className="sb-btn" onClick={() => { const n = Math.min(96, size + 2); run(() => applyFontSize(ed.current!, n)); setSize(n); }} title="Bigger" aria-label="Bigger text">A+</button>
      {open === "size" && <div className="sb-pop sizes" role="listbox">{SIZES.map((n) => <button key={n} role="option" aria-selected={n === size} className={n === size ? "on" : ""} onClick={() => { run(() => applyFontSize(ed.current!, n)); setSize(n); setOpen(""); }}>{n}</button>)}</div>}
    </div>
    <div className="selbar-group">
      <button className="sb-btn" onClick={() => setOpen(open === "color" ? "" : "color")} title="Font colour" aria-label="Font colour"><span className="sb-A">A</span><i className="sb-bar" style={{ background: "#E03131" }} /></button>
      <button className="sb-btn" onClick={() => setOpen(open === "mark" ? "" : "mark")} title="Highlight" aria-label="Highlight"><span className="sb-hl">ab</span><i className="sb-bar" style={{ background: "#FFE45C" }} /></button>
      {open === "color" && <div className="sb-pop swatches" aria-label="Font colours">{COLORS.map((c) => <button key={c} className="sw" style={{ background: c }} aria-label={"Colour " + c} onClick={() => { run(() => applyColor("foreColor", c)); setOpen(""); }} />)}
        <label className="sw custom" title="Custom colour">+<input type="color" onChange={(e) => run(() => applyColor("foreColor", e.target.value))} /></label></div>}
      {open === "mark" && <div className="sb-pop swatches" aria-label="Highlight colours">{MARKS.map((c) => <button key={c} className={"sw" + (c === "transparent" ? " none" : "")} style={{ background: c }} aria-label={c === "transparent" ? "No highlight" : "Highlight " + c} onClick={() => { run(() => applyColor("hiliteColor", c)); setOpen(""); }} />)}</div>}
    </div>
    <div className="selbar-group">
      <button className="sb-btn" onClick={() => run(() => document.execCommand("bold"))} aria-label="Bold"><b>B</b></button>
      <button className="sb-btn" onClick={() => run(() => document.execCommand("italic"))} aria-label="Italic"><i>I</i></button>
      <button className="sb-btn" onClick={() => run(() => document.execCommand("underline"))} aria-label="Underline"><u>U</u></button>
      <button className="sb-btn" onClick={() => run(() => document.execCommand("formatBlock", false, "h2"))} title="Heading" aria-label="Heading">H</button>
      <button className="sb-btn" onClick={() => run(() => document.execCommand("insertUnorderedList"))} title="Bullet list" aria-label="Bullet list">•≡</button>
    </div>
    <div className="selbar-group last">
      <button className="sb-btn go" onClick={() => { const t = text(); if (t) onVisualize(t); }} title="Turn this text into a visual">✦ Visualize</button>
      <button className="sb-btn" onClick={() => { const t = text(); if (t) onAsk(t); }} title="Ask the companion about this">Ask</button>
      <button className="sb-btn" onClick={() => { const t = text(); if (reading || t) onRead(t); }} title={reading ? "Stop reading" : "Read the selected text aloud"} aria-label={reading ? "Stop reading" : "Read the selected text aloud"} aria-pressed={reading}>{reading ? "■ Stop" : "🔊 Read"}</button>
      {readIn && !reading && <button className="sb-btn" onClick={() => { const t = text(); if (t) readIn.go(t); }} title={`Hear it explained in ${readIn.label} (Gnani voice)`}>🔊 {readIn.label}</button>}
    </div>
  </div>;
}
