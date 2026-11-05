import { useRef } from "react";
import { Obj } from "./editing";
type P = { objects: Obj[]; selected: string | null; k: number; onSelect: (id: string | null) => void; onPatch: (id: string, patch: Partial<Obj>) => void; onDelete: (id: string) => void; onCopy: (id: string) => void; onRestyle: (o: Obj) => void };
const CORNERS = ["nw", "ne", "sw", "se"] as const;
/** Free-floating images and visuals: click to select, drag to move, drag any corner to resize (aspect ratio kept). */
export default function ObjectLayer({ objects, selected, k, onSelect, onPatch, onDelete, onCopy, onRestyle }: P) {
  const drag = useRef<any>(null);
  const begin = (e: React.PointerEvent, o: Obj, mode: string) => {
    e.stopPropagation(); e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur?.(); onSelect(o.id); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: o.id, mode, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h, ratio: o.w / o.h };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return; const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (d.mode === "move") return onPatch(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) });
    const grow = d.mode.includes("e") ? dx : -dx; let w = Math.max(48, d.ow + grow); const h = w / d.ratio;
    onPatch(d.id, { w: Math.round(w), h: Math.round(h), x: Math.round(d.mode.includes("w") ? d.ox + (d.ow - w) : d.ox), y: Math.round(d.mode.includes("n") ? d.oy + (d.oh - h) : d.oy) });
  };
  const end = () => { drag.current = null; };
  return <div className="obj-layer">{objects.map((o) => {
    const on = o.id === selected;
    return <div key={o.id} className={"obj" + (on ? " on" : "")} style={{ left: o.x, top: o.y, width: o.w, height: o.h }} onPointerDown={(e) => begin(e, o, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} role="img" aria-label={o.alt || "Image"}>
      <img src={o.src} alt={o.alt} draggable={false} />
      {on && <>
        {CORNERS.map((c) => <span key={c} className={"handle h-" + c} onPointerDown={(e) => begin(e, o, c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />)}
        <div className="obj-actions" onPointerDown={(e) => e.stopPropagation()}>
          {o.kind === "visual" && (o.meta?.spec || o.meta?.lspec) && <button className="btn sm" onClick={() => onRestyle(o)}>Change style</button>}
          <button className="btn sm" onClick={() => onCopy(o.id)} title="Copy (Ctrl+C), then paste on any sheet">Copy</button>
          <button className="btn sm coral" onClick={() => onDelete(o.id)} aria-label="Delete image">Delete</button>
        </div>
      </>}
    </div>;
  })}</div>;
}
