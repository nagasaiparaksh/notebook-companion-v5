import { memo, useRef, useState } from "react";
import { Sheet, PAGE_W, PAGE_H, sanitize } from "./editing";
type P = { sheets: Sheet[]; active: number; ver: number; onSelect: (i: number) => void; onAdd: () => void; onDuplicate: (i: number) => void; onDelete: (i: number) => void; onMove: (from: number, to: number) => void; onClose: () => void };
const TW = 150, S = TW / PAGE_W;
/** PowerPoint-style strip of sheet thumbnails: click to open, drag to reorder, hover for duplicate / delete. */
function SheetPanel({ sheets, active, onSelect, onAdd, onDuplicate, onDelete, onMove, onClose }: P) {
  const from = useRef<number | null>(null); const [over, setOver] = useState<number | null>(null);
  return <nav className="sheet-panel" aria-label="Sheets in this notebook">
    <div className="sp-head"><b>Sheets</b><span className="muted">{sheets.length}</span><button className="btn sm ghost" onClick={onClose} aria-label="Hide sheet panel">Hide</button></div>
    <button className="btn mint sp-add" onClick={onAdd}>+ New sheet</button>
    <ol className="sp-list">{sheets.map((s, i) => <li key={s.id} className={(i === active ? "on " : "") + (over === i ? "over" : "")} draggable
      onDragStart={(e) => { from.current = i; e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); setOver(null); if (from.current !== null && from.current !== i) onMove(from.current, i); from.current = null; }} onDragEnd={() => { from.current = null; setOver(null); }}>
      <span className="sp-num">{i + 1}</span>
      <button className="sp-thumb" style={{ width: TW, height: Math.round(PAGE_H * S) }} onClick={() => onSelect(i)} aria-label={"Sheet " + (i + 1)} aria-current={i === active}>
        <div className="th-page" style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${S})` }}>
          <div className="th-text" dangerouslySetInnerHTML={{ __html: sanitize(s.html) }} />
          {s.objects.map((o) => <img key={o.id} src={o.src} alt="" style={{ position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h }} />)}
        </div>
      </button>
      <span className="sp-tools"><button onClick={() => onDuplicate(i)} title="Duplicate sheet" aria-label={"Duplicate sheet " + (i + 1)}>⧉</button><button onClick={() => onDelete(i)} title="Delete sheet" aria-label={"Delete sheet " + (i + 1)}>✕</button></span>
    </li>)}</ol>
  </nav>;
}
export default memo(SheetPanel, (a, b) => a.ver === b.ver && a.active === b.active && a.sheets.length === b.sheets.length);
