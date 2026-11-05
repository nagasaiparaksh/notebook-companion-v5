import { useCallback, useEffect, useRef, useState } from "react"; import { useNavigate, useSearchParams } from "react-router-dom";
import { Stage, Layer, Group, Path, Text, Transformer, Rect } from "react-konva"; import { jsPDF } from "jspdf";
import { api } from "../api"; import { El, shapePath, arrowGeom, bbox, toSvg } from "./sketch";
const COLORS = ["#FFF3A3", "#C9F2DD", "#FFD0C2", "#D9D2FF", "#BFD4FF", "#FFE0C7", "#FFFFFF", "#FF7A5C"];
const uid = () => Math.random().toString(36).slice(2, 10);
const mk = (type: El["type"], x: number, y: number): El => ({ id: uid(), type, x, y, w: type === "text" ? 160 : 160, h: type === "text" ? 40 : 80, rotation: 0, text: type === "text" ? "Label" : "", fontSize: 20, fill: type === "text" || type === "arrow" ? "none" : "#FFF3A3", stroke: type === "arrow" ? "#3B5BDB" : "#2B2B2B", strokeWidth: 2.5, seed: Math.floor(Math.random() * 90) + 1, group: null });
export default function Studio() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const [els, setEls] = useState<El[]>([]), [past, setPast] = useState<El[][]>([]), [future, setFuture] = useState<El[][]>([]);
  const [sel, setSel] = useState<string[]>([]), [tool, setTool] = useState<"select" | "pan" | "link">("select"), [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }), [size, setSize] = useState({ w: 800, h: 560 }), [id, setId] = useState<number | null>(null), [title, setTitle] = useState("Untitled diagram");
  const [prompt, setPrompt] = useState(""), [cat, setCat] = useState("any"), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [list, setList] = useState<any[]>([]), [dirty, setDirty] = useState(false), [box, setBox] = useState<any>(null);
  const wrap = useRef<HTMLDivElement>(null), stage = useRef<any>(null), tr = useRef<any>(null), bg = useRef<any>(null), nodes = useRef<Record<string, any>>({}), gesture = useRef<{ snap: El[]; start: Record<string, [number, number]> } | null>(null), spaceDown = useRef(false), elsRef = useRef<El[]>([]);
  elsRef.current = els;
  const refreshList = () => api("/diagrams").then(setList).catch(() => {});
  useEffect(() => { refreshList(); const o = sp.get("open"); if (o) openDiagram(+o); const incoming = sp.get("prompt"); if (incoming) setPrompt(incoming); }, []);
  useEffect(() => { const ro = new ResizeObserver(() => wrap.current && setSize({ w: wrap.current.clientWidth, h: wrap.current.clientHeight })); ro.observe(wrap.current!); return () => ro.disconnect(); }, []);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [dirty]);
  useEffect(() => { tr.current?.nodes(sel.map((i) => nodes.current[i]).filter(Boolean).filter((n) => elsRef.current.find((e) => e.id === n.id())?.type !== "arrow")); tr.current?.getLayer()?.batchDraw(); }, [sel, els.length]);
  const commit = (next: El[]) => { setPast((p) => [...p.slice(-60), elsRef.current]); setFuture([]); setEls(next); setDirty(true); };
  const undo = () => { if (!past.length) return; setFuture((f) => [els, ...f]); setEls(past[past.length - 1]); setPast(past.slice(0, -1)); setDirty(true); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, els]); setEls(future[0]); setFuture(future.slice(1)); setDirty(true); };
  const patch = (ids: string[], p: Partial<El>) => commit(els.map((e) => (ids.includes(e.id) ? { ...e, ...p } : e)));
  const selEls = els.filter((e) => sel.includes(e.id)), one = selEls.length === 1 ? selEls[0] : null;
  const del = () => { const keep = els.filter((e) => !sel.includes(e.id)).filter((e) => !(e.type === "arrow" && ((e.from && sel.includes(e.from)) || (e.to && sel.includes(e.to))))); commit(keep); setSel([]); };
  const dup = () => { const m: Record<string, string> = {}, c = selEls.map((e) => { m[e.id] = uid(); return { ...e, id: m[e.id], x: e.x + 30, y: e.y + 30, group: e.group ? "g" + e.group : null }; }).map((e) => ({ ...e, from: e.from && m[e.from] ? m[e.from] : e.from, to: e.to && m[e.to] ? m[e.to] : e.to })); commit([...els, ...c]); setSel(c.map((e) => e.id)); };
  useEffect(() => { const dn = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.code === "Space") spaceDown.current = true; const m = e.ctrlKey || e.metaKey;
      if (m && e.key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if (m && e.key === "y") { e.preventDefault(); redo(); } else if (m && e.key === "d") { e.preventDefault(); sel.length && dup(); } else if ((e.key === "Delete" || e.key === "Backspace") && sel.length) del(); };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; }; window.addEventListener("keydown", dn); window.addEventListener("keyup", up); return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); }; });
  const add = (type: El["type"]) => { const cx = (size.w / 2 - view.x) / view.k, cy = (size.h / 2 - view.y) / view.k, e = mk(type, cx - 80 + (els.length % 5) * 12, cy - 40 + (els.length % 5) * 12); if (type === "arrow") { e.w = 140; e.h = 0; } commit([...els, e]); setSel([e.id]); setTool("select"); };
  const clickEl = (e: El, ev: any) => {
    if (tool === "link" && e.type !== "arrow" && e.type !== "text") { if (!linkFrom) { setLinkFrom(e.id); return; } if (linkFrom !== e.id) { const a = mk("arrow", 0, 0); a.from = linkFrom; a.to = e.id; commit([...els, a]); setSel([a.id]); } setLinkFrom(null); setTool("select"); return; }
    const ids = e.group ? els.filter((x) => x.group === e.group).map((x) => x.id) : [e.id]; const multi = ev.evt.shiftKey || ev.evt.ctrlKey || ev.evt.metaKey;
    setSel(multi ? (ids.every((i) => sel.includes(i)) ? sel.filter((s) => !ids.includes(s)) : [...new Set([...sel, ...ids])]) : ids);
  };
  const dragStart = () => { gesture.current = { snap: els, start: Object.fromEntries(els.filter((e) => sel.includes(e.id)).map((e) => [e.id, [e.x, e.y]])) }; };
  const dragMove = (e: El, ev: any) => { const g = gesture.current; if (!g) return; const n = ev.target, dx = n.x() - e.w / 2 - g.start[e.id][0], dy = n.y() - e.h / 2 - g.start[e.id][1];
    setEls((cur) => cur.map((x) => (g.start[x.id] ? { ...x, x: g.start[x.id][0] + dx, y: g.start[x.id][1] + dy } : x))); };
  const dragEnd = () => { const g = gesture.current; if (g) { setPast((p) => [...p.slice(-60), g.snap]); setFuture([]); setDirty(true); } gesture.current = null; };
  const xformEnd = (e: El, ev: any) => { const n = ev.target, w = Math.max(30, e.w * n.scaleX()), h = Math.max(20, e.h * n.scaleY()); n.scaleX(1); n.scaleY(1); commit(els.map((x) => (x.id === e.id ? { ...x, w, h, x: n.x() - w / 2, y: n.y() - h / 2, rotation: n.rotation() } : x))); };
  const wheel = (ev: any) => { ev.evt.preventDefault(); const s = stage.current, p = s.getPointerPosition(), k0 = view.k, k = Math.min(4, Math.max(0.2, ev.evt.deltaY < 0 ? k0 * 1.1 : k0 / 1.1)); setView({ k, x: p.x - ((p.x - view.x) / k0) * k, y: p.y - ((p.y - view.y) / k0) * k }); };
  const zoom = (f: number) => { const k = Math.min(4, Math.max(0.2, view.k * f)); setView({ k, x: size.w / 2 - ((size.w / 2 - view.x) / view.k) * k, y: size.h / 2 - ((size.h / 2 - view.y) / view.k) * k }); };
  const fit = () => { const b = bbox(els), k = Math.min(1.5, size.w / b.w, size.h / b.h); setView({ k, x: (size.w - b.w * k) / 2 - b.x * k, y: (size.h - b.h * k) / 2 - b.y * k }); };
  const world = () => { const p = stage.current.getPointerPosition(); return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k }; };
  const down = (ev: any) => { if (ev.target !== stage.current && ev.target.name() !== "bg") return; if (!ev.evt.shiftKey) setSel([]); if (tool === "select" && !spaceDown.current && ev.evt.button === 0) { const w = world(); setBox({ x0: w.x, y0: w.y, x1: w.x, y1: w.y }); } };
  const move = () => { if (box) { const w = world(); setBox({ ...box, x1: w.x, y1: w.y }); } };
  const up = () => { if (!box) return; const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    if (x1 - x0 > 4 || y1 - y0 > 4) setSel(els.filter((e) => e.type !== "arrow" && e.x < x1 && e.x + e.w > x0 && e.y < y1 && e.y + e.h > y0).map((e) => e.id)); setBox(null); };
  const group = () => { const g = uid(); patch(sel.filter((i) => els.find((e) => e.id === i)?.type !== "arrow"), { group: g }); };
  const align = (m: string) => { const t = selEls.filter((e) => e.type !== "arrow"); if (t.length < 2) return; const L = Math.min(...t.map((e) => e.x)), R = Math.max(...t.map((e) => e.x + e.w)), T = Math.min(...t.map((e) => e.y)), B = Math.max(...t.map((e) => e.y + e.h));
    const f: Record<string, (e: El) => Partial<El>> = { left: () => ({ x: L }), right: (e) => ({ x: R - e.w }), center: (e) => ({ x: (L + R) / 2 - e.w / 2 }), top: () => ({ y: T }), bottom: (e) => ({ y: B - e.h }), middle: (e) => ({ y: (T + B) / 2 - e.h / 2 }) };
    if (m === "dh" || m === "dv") { const h = m === "dh", s = [...t].sort((a, b) => (h ? a.x - b.x : a.y - b.y)), tot = s.reduce((a, e) => a + (h ? e.w : e.h), 0), gap = ((h ? R - L : B - T) - tot) / (s.length - 1); let pos = h ? L : T; const o: Record<string, number> = {}; s.forEach((e) => { o[e.id] = pos; pos += (h ? e.w : e.h) + gap; }); commit(els.map((e) => (o[e.id] !== undefined ? { ...e, [h ? "x" : "y"]: o[e.id] } : e))); return; }
    commit(els.map((e) => (sel.includes(e.id) && e.type !== "arrow" ? { ...e, ...f[m](e) } : e))); };
  const layer = (front: boolean) => { const s = els.filter((e) => sel.includes(e.id)), r = els.filter((e) => !sel.includes(e.id)); commit(front ? [...r, ...s] : [...s, ...r]); };
  async function generate() { setBusy("Sketching…"); setErr(""); try { const j = await api("/diagrams/generate", { json: { prompt, category: cat } }); commit(j.data.elements); setTitle(j.title); setSel([]); setId(null); setTimeout(fit, 50); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } }
  async function save() { setBusy("Saving…"); setErr(""); try {
    const svg = toSvg(els, true);
    const body = { title, data: { version: 1, elements: els }, svg };
    let savedId = id;
    if (savedId) await api("/diagrams/" + savedId, { method: "PUT", json: body });
    else { const j = await api("/diagrams", { json: body }); savedId = j.id; setId(j.id); setSp({ open: String(j.id) }); }
    setDirty(false); refreshList();
    const noteId = sp.get("noteId");
    if (noteId && svg) {
      const note = await api("/notes/" + noteId);
      const image = `<p><img alt="${title.replace(/[&<>"]/g, "")}" style="max-width:100%;height:auto" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></p>`;
      await api("/notes/" + noteId, { method: "PUT", json: { content: (note.content || "") + image, diagram_ids: [...new Set([...(note.diagram_ids || []), savedId])] } });
      nav("/notes?open=" + noteId);
    }
  } catch (e: any) { setErr(e.message); } finally { setBusy(""); } }
  async function openDiagram(i: number) { if (dirty && !confirm("Discard unsaved changes?")) return; try { const d = await api("/diagrams/" + i); setEls(d.data.elements || []); setPast([]); setFuture([]); setId(i); setTitle(d.title); setSel([]); setDirty(false); setSp({ open: String(i) }); setTimeout(fit, 80); } catch (e: any) { setErr(e.message); } }
  const newOne = () => { if (dirty && !confirm("Discard unsaved changes?")) return; setEls([]); setPast([]); setFuture([]); setId(null); setTitle("Untitled diagram"); setDirty(false); setSp({}); };
  const download = (href: string, name: string) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); };
  const png = () => { const b = bbox(els), s = stage.current, o = { x: s.x(), y: s.y(), sx: s.scaleX() }; tr.current.visible(false); bg.current.visible(true); s.scale({ x: 1, y: 1 }); s.position({ x: 0, y: 0 });
    const url = s.toDataURL({ x: b.x, y: b.y, width: b.w, height: b.h, pixelRatio: 2 }); s.scale({ x: o.sx, y: o.sx }); s.position({ x: o.x, y: o.y }); tr.current.visible(true); bg.current.visible(false); return { url, b }; };
  const exportAs = (k: string) => { if (!els.length) return setErr("Nothing to export yet."); if (k === "svg") { const u = URL.createObjectURL(new Blob([toSvg(els, true)], { type: "image/svg+xml" })); download(u, title + ".svg"); }
    else { const { url, b } = png(); if (k === "png") download(url, title + ".png"); else { const d = new jsPDF({ orientation: b.w > b.h ? "l" : "p", unit: "px", format: [b.w, b.h] }); d.addImage(url, "PNG", 0, 0, b.w, b.h); d.save(title + ".pdf"); } } };
  const bgSize = 24 * view.k;
  return <div className="col"><div className="row"><input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} style={{ fontSize: "1.4rem" }} aria-label="Diagram title" /><span className="muted">{dirty ? "unsaved" : id ? "saved" : ""}</span>
      <button className="btn mint" onClick={save} disabled={!!busy || !els.length}>Save</button><button className="btn ghost" onClick={newOne}>New</button>
      <select value="" onChange={(e) => e.target.value && openDiagram(+e.target.value)}><option value="">Open saved…</option>{list.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
      {id && <button className="btn sm coral" onClick={async () => { if (confirm("Delete this diagram?")) { await api("/diagrams/" + id, { method: "DELETE" }); newOne(); refreshList(); } }}>Delete</button>}</div>
    <div className="row"><input className="grow" placeholder="Describe a diagram: “labelled CNN with input, convolution, ReLU, pooling, flatten, dense, output”" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && prompt.trim() && generate()} />
      <select value={cat} onChange={(e) => setCat(e.target.value)}>{["any", "neural network", "flowchart", "mind map", "concept map", "UML", "software architecture", "biology", "science process", "network"].map((c) => <option key={c}>{c}</option>)}</select>
      <button className="btn blue" disabled={!prompt.trim() || !!busy} onClick={generate}>{busy === "Sketching…" ? busy : "Generate"}</button></div>
    {err && <div className="err" onClick={() => setErr("")}>{err}</div>}
    <div className="toolbar">{(["select", "pan", "link"] as const).map((t) => <button key={t} className={"btn sm " + (tool === t ? "lav" : "ghost")} onClick={() => { setTool(t); setLinkFrom(null); }}>{t === "select" ? "Select" : t === "pan" ? "Hand" : linkFrom ? "Pick target…" : "Connect"}</button>)}
      {(["rect", "ellipse", "diamond", "text", "arrow"] as const).map((t) => <button key={t} className="btn sm" onClick={() => add(t)}>+ {t === "rect" ? "Box" : t === "ellipse" ? "Oval" : t === "diamond" ? "Diamond" : t === "text" ? "Text" : "Arrow"}</button>)}
      <button className="btn sm ghost" onClick={undo} disabled={!past.length}>Undo</button><button className="btn sm ghost" onClick={redo} disabled={!future.length}>Redo</button>
      <button className="btn sm ghost" onClick={() => zoom(1.2)}>＋</button><button className="btn sm ghost" onClick={() => zoom(1 / 1.2)}>－</button><button className="btn sm ghost" onClick={fit}>Fit</button>
      <button className="btn sm peach" onClick={() => exportAs("png")}>PNG</button><button className="btn sm peach" onClick={() => exportAs("svg")}>SVG</button><button className="btn sm peach" onClick={() => exportAs("pdf")}>PDF</button></div>
    <div className="studio"><div className="canvas-wrap" ref={wrap} style={{ backgroundSize: `${bgSize}px ${bgSize}px`, backgroundPosition: `${view.x}px ${view.y}px`, cursor: tool === "pan" ? "grab" : "default" }}>
      <Stage ref={stage} width={size.w} height={size.h} x={view.x} y={view.y} scaleX={view.k} scaleY={view.k} draggable={tool === "pan"} onDragEnd={(e) => e.target === stage.current && setView({ ...view, x: e.target.x(), y: e.target.y() })}
        onWheel={wheel} onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down}>
        <Layer><Rect ref={bg} name="bg" x={-5000} y={-5000} width={10000} height={10000} fill="#fff" visible={false} listening={false} /></Layer>
        <Layer>
          {els.filter((e) => e.type !== "arrow").map((e) => <Group key={e.id} id={e.id} ref={(n) => { if (n) nodes.current[e.id] = n; }} x={e.x + e.w / 2} y={e.y + e.h / 2} offsetX={e.w / 2} offsetY={e.h / 2} width={e.w} height={e.h} rotation={e.rotation}
            draggable={tool === "select"} onClick={(ev) => clickEl(e, ev)} onTap={(ev) => clickEl(e, ev)} onDragStart={dragStart} onDragMove={(ev) => dragMove(e, ev)} onDragEnd={dragEnd} onTransformEnd={(ev) => xformEnd(e, ev)}
            onDblClick={() => { const t = window.prompt("Label text", e.text || ""); if (t !== null) patch([e.id], { text: t }); }}>
            {e.type !== "text" && <Path data={shapePath(e)} fill={e.fill} stroke={linkFrom === e.id ? "#FF7A5C" : e.stroke} strokeWidth={e.strokeWidth} lineJoin="round" />}
            {e.type === "text" && <Rect width={e.w} height={e.h} fill="rgba(0,0,0,0.001)" />}
            <Text text={e.text || ""} width={e.w} height={e.h} align="center" verticalAlign="middle" fontSize={e.fontSize} fontFamily="Patrick Hand" fill="#2B2B2B" padding={4} listening={false} /></Group>)}
          {els.filter((e) => e.type === "arrow").map((e) => { const g = arrowGeom(e, els), free = !e.from && !e.to; const s = sel.includes(e.id);
            return <Group key={e.id} id={e.id} ref={(n) => { if (n) nodes.current[e.id] = n; }} x={0} y={0} draggable={free && tool === "select"} onClick={(ev) => clickEl(e, ev)} onTap={(ev) => clickEl(e, ev)} onDragStart={dragStart}
              onDragMove={(ev) => { const g2 = gesture.current; if (g2) setEls((c) => c.map((x) => (x.id === e.id ? { ...x, x: g2.start[e.id][0] + ev.target.x(), y: g2.start[e.id][1] + ev.target.y() } : x))); }} onDragEnd={(ev) => { ev.target.position({ x: 0, y: 0 }); dragEnd(); }}>
              <Path data={g.d} stroke={s ? "#FF7A5C" : e.stroke} strokeWidth={e.strokeWidth + (s ? 1.5 : 0)} hitStrokeWidth={16} lineCap="round" />
              {e.text && <Text text={e.text} x={g.label[0] - 60} y={g.label[1] - 24} width={120} align="center" fontSize={e.fontSize} fontFamily="Patrick Hand" fill="#2B2B2B" listening={false} />}</Group>; })}
          <Transformer ref={tr} rotateEnabled keepRatio={false} anchorSize={9} borderStroke="#3B5BDB" anchorStroke="#3B5BDB" boundBoxFunc={(a, b) => (b.width < 30 || b.height < 20 ? a : b)} />
          {box && <Rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} stroke="#3B5BDB" dash={[6, 4]} fill="rgba(59,91,219,.08)" listening={false} />}
        </Layer></Stage>
      {!els.length && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}><span className="muted">Describe a diagram above, or add shapes from the toolbar. Double-click a shape to rename it.</span></div>}</div>
      <aside className="col" style={{ overflowY: "auto" }}>
        {!sel.length ? <p className="muted">Click a shape to edit it. Drag on empty space to select several. Hold Space or use Hand to pan; scroll to zoom.</p> : <>
          {one && one.type !== "arrow" || one?.type === "arrow" ? <label>Label<input style={{ width: "100%" }} value={one!.text || ""} onChange={(e) => patch([one!.id], { text: e.target.value })} /></label> : <p>{sel.length} selected</p>}
          <label>Font size <input type="range" min="10" max="48" value={selEls[0]?.fontSize || 20} onChange={(e) => patch(sel, { fontSize: +e.target.value })} /></label>
          <label>Line thickness <input type="range" min="1" max="10" step=".5" value={selEls[0]?.strokeWidth || 2.5} onChange={(e) => patch(sel, { strokeWidth: +e.target.value })} /></label>
          {selEls.some((e) => e.type !== "arrow" && e.type !== "text") && <div><div>Fill</div><div className="row" style={{ gap: 4 }}>{COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={"Fill " + c} onClick={() => patch(sel.filter((i) => { const t = els.find((e) => e.id === i)!.type; return t !== "arrow" && t !== "text"; }), { fill: c })} />)}</div></div>}
          <div><div>Line colour</div><div className="row" style={{ gap: 4 }}>{["#2B2B2B", "#3B5BDB", "#FF7A5C", "#2F9E6B", "#7048E8"].map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={"Line " + c} onClick={() => patch(sel, { stroke: c })} />)}</div></div>
          {one?.type === "arrow" && <><label>From<select value={one.from || ""} onChange={(e) => patch([one.id], { from: e.target.value || undefined })}><option value="">(free end)</option>{els.filter((e) => e.type !== "arrow" && e.type !== "text").map((e) => <option key={e.id} value={e.id}>{e.text || e.type}</option>)}</select></label>
            <label>To<select value={one.to || ""} onChange={(e) => patch([one.id], { to: e.target.value || undefined })}><option value="">(free end)</option>{els.filter((e) => e.type !== "arrow" && e.type !== "text").map((e) => <option key={e.id} value={e.id}>{e.text || e.type}</option>)}</select></label></>}
          <div className="row" style={{ gap: 4 }}><button className="btn sm" onClick={dup}>Duplicate</button><button className="btn sm coral" onClick={del}>Delete</button><button className="btn sm lav" onClick={group} disabled={sel.length < 2}>Group</button>
            <button className="btn sm ghost" onClick={() => patch(sel, { group: null })} disabled={!selEls.some((e) => e.group)}>Ungroup</button><button className="btn sm ghost" onClick={() => layer(true)}>To front</button><button className="btn sm ghost" onClick={() => layer(false)}>To back</button></div>
          {sel.length > 1 && <div className="row" style={{ gap: 4 }}>{[["left", "⇤"], ["center", "↔"], ["right", "⇥"], ["top", "⤒"], ["middle", "↕"], ["bottom", "⤓"], ["dh", "|·|·|"], ["dv", "≡"]].map(([m, l]) => <button key={m} className="btn sm ghost" title={"Align " + m} onClick={() => align(m)}>{l}</button>)}</div>}</>}
      </aside></div></div>;
}
