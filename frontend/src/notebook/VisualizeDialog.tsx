import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { LSpec, altForLabelled, renderLabelled } from "../labelled";
import { ALL_KINDS, KIND_LABEL, PALETTES, THEMES, ThemeId, VSpec, altFor, renderVisual, toDataUri } from "../visuals";
export type VizResult = { src: string; alt: string; w: number; h: number; meta: any };
type P = { text: string; topic?: boolean; hint?: string; initial?: any; onInsert: (r: VizResult) => void; onClose: () => void };
export function buildViz(spec: VSpec, kind: string, theme: ThemeId, paletteId: string, showTitle: boolean): VizResult {
  const pal = PALETTES.find((p) => p.id === paletteId) || PALETTES[0], r = renderVisual(spec, kind, theme, pal, showTitle);
  return { src: toDataUri(r.svg), alt: altFor(spec), w: r.w, h: r.h, meta: { spec, kind, theme, palette: paletteId, showTitle } };
}
export function buildLabelled(spec: LSpec, theme: ThemeId, paletteId: string, showTitle: boolean): VizResult {
  const pal = PALETTES.find((p) => p.id === paletteId) || PALETTES[0], r = renderLabelled(spec, theme, pal, showTitle);
  return { src: toDataUri(r.svg), alt: altForLabelled(spec), w: r.w, h: r.h, meta: { mode: "labelled", lspec: spec, theme, palette: paletteId, showTitle } };
}
function LabelledPanel({ text, topic, initial, onInsert }: { text: string; topic?: boolean; initial?: any; onInsert: (r: VizResult) => void }) {
  const [subject, setSubject] = useState(topic ? text : ""), [spec, setSpec] = useState<LSpec | null>(initial?.lspec || null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [secs, setSecs] = useState(0), [edit, setEdit] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(initial?.theme || "notebook"), [pal, setPal] = useState<string>(initial?.palette || "pastel"), [title, setTitle] = useState<boolean>(initial ? !!initial.showTitle : true), run = useRef(0);
  const draw = async () => {
    const my = ++run.current; setBusy(true); setErr(""); setSecs(0); const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
    try { const r = await api("/visuals/labelled", { json: { subject: subject.trim(), text: topic ? "" : text }, signal: ctl.signal }); if (my === run.current) setSpec(r.figure); }
    catch (e: any) { if (my === run.current) setErr(e.message || "Couldn't draw that."); } finally { clearTimeout(t); if (my === run.current) setBusy(false); }
  };
  useEffect(() => { if (!initial?.lspec) draw(); return () => { run.current++; }; }, []);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, [busy]);
  const built = useMemo(() => (spec ? buildLabelled(spec, theme, pal, title) : null), [spec, theme, pal, title]);
  const patch = (i: number, p: any) => spec && setSpec({ ...spec, parts: spec.parts.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  return <div className="viz-lab">
    <form className="row" onSubmit={(e) => { e.preventDefault(); draw(); }}>
      <label className="muted" htmlFor="lab-subject">Draw a labelled diagram of</label>
      <input id="lab-subject" className="grow lab-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={topic ? "e.g. heart" : "leave empty to use your selected text, or type e.g. heart, eye, volcano"} />
      <button className="btn sm blue" disabled={busy}>{busy ? "Drawing…" : spec ? "Draw again" : "Draw"}</button>
    </form>
    {busy && <div className="viz-wait" role="status"><span className="spinner" /> Drawing and labelling… {secs}s{secs > 10 ? " (new subjects are drawn by the AI, which can take up to a minute)" : ""}</div>}
    {err && <div className="err">{err}</div>}
    {built && !busy && spec && <>
      <div className="viz-preview"><img src={built.src} alt={built.alt} /></div>
      <p className="muted lab-note">{spec.source === "ai" ? "Drawn by the AI, so check that each dot sits on the right part. You can edit the names below, or press Draw again for another attempt." : "Built-in illustration (works without the AI)."}</p>
      <div className="viz-controls">
        <div className="row"><span className="muted">Style</span>{THEMES.map((t) => <button key={t.id} className={"chip" + (t.id === theme ? " on" : "")} onClick={() => setTheme(t.id)}>{t.name}</button>)}</div>
        <div className="row"><span className="muted">Colours</span>{PALETTES.map((p) => <button key={p.id} className={"pal" + (p.id === pal ? " on" : "")} onClick={() => setPal(p.id)} aria-label={p.name} title={p.name}>{p.solid.slice(0, 4).map((c) => <i key={c} style={{ background: c }} />)}</button>)}
          <label className="muted"><input type="checkbox" checked={title} onChange={(e) => setTitle(e.target.checked)} /> Title</label></div>
        <button className="btn sm ghost" onClick={() => setEdit(!edit)} aria-expanded={edit}>{edit ? "Hide label editor" : "Edit labels"}</button>
        {edit && <div className="viz-edit">{spec.parts.map((q, i) => <div className="row" key={i}>
          <input className="grow" value={q.label} onChange={(e) => patch(i, { label: e.target.value })} aria-label={"Label " + (i + 1)} />
          <input className="grow" value={q.detail || ""} onChange={(e) => patch(i, { detail: e.target.value })} aria-label={"Description " + (i + 1)} placeholder="description" />
          <button className="btn sm ghost" disabled={spec.parts.length <= 2} onClick={() => setSpec({ ...spec, parts: spec.parts.filter((_, j) => j !== i) })} aria-label={"Remove " + q.label}>✕</button></div>)}</div>}
      </div>
      <div className="row viz-foot"><button className="btn blue" onClick={() => onInsert(built)}>Insert into sheet</button><span className="muted">Drag it anywhere on the sheet afterwards; drag a corner to resize.</span></div>
    </>}
  </div>;
}
export default function VisualizeDialog({ text, topic, hint, initial, onInsert, onClose }: P) {
  const startMode: "infographic" | "labelled" = initial ? (initial.mode === "labelled" ? "labelled" : "infographic") : hint === "labelled" ? "labelled" : "infographic";
  const [mode, setMode] = useState(startMode), [labSeen, setLabSeen] = useState(startMode === "labelled");
  const [spec, setSpec] = useState<VSpec | null>(initial?.spec || null), [fallback, setFallback] = useState(false), [aiErr, setAiErr] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(!initial && startMode === "infographic"), [secs, setSecs] = useState(0);
  const [kind, setKind] = useState<string>(initial?.kind || ""), [theme, setTheme] = useState<ThemeId>(initial?.theme || "notebook"), [pal, setPal] = useState<string>(initial?.palette || "pastel"), [title, setTitle] = useState<boolean>(!!initial?.showTitle), [edit, setEdit] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null), run = useRef(0);
  const generate = async () => {
    const my = ++run.current; setBusy(true); setErr(""); setAiErr(""); setSecs(0); const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 50000);
    try {
      const r = await api("/visuals/generate", { json: { text, topic: !!topic, hint: hint || "" }, signal: ctl.signal }); if (my !== run.current) return;
      setSpec(r.spec); setKind((k) => k || r.spec.kinds[0]); setFallback(!!r.fallback); setAiErr(r.ai_error || "");
    } catch (e: any) { if (my === run.current) setErr(e.message || "Couldn't build a visual."); } finally { clearTimeout(t); if (my === run.current) setBusy(false); }
  };
  useEffect(() => { if (!initial && startMode === "infographic") generate(); closeBtn.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => { run.current++; window.removeEventListener("keydown", k); }; }, []);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);
  const kinds = useMemo(() => (spec ? [...new Set([...spec.kinds, ...ALL_KINDS])].slice(0, 7) : []), [spec]);
  const thumbs = useMemo(() => (spec ? kinds.map((k) => ({ k, v: buildViz(spec, k, theme, pal, title) })) : []), [spec, kinds, theme, pal, title]);
  const cur = thumbs.find((t) => t.k === kind) || thumbs[0];
  const pick = (m: "infographic" | "labelled") => { setMode(m); if (m === "labelled") setLabSeen(true); else if (!spec && !busy && !err) generate(); };
  const patchNode = (i: number, p: any) => spec && setSpec({ ...spec, nodes: spec.nodes.map((n, j) => (j === i ? { ...n, ...p } : n)) });
  return <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal viz" role="dialog" aria-modal="true" aria-label="Turn text into a visual">
      <div className="row viz-head"><h2 className="grow">Turn text into a visual</h2><button ref={closeBtn} className="btn sm ghost" onClick={onClose}>Close</button></div>
      <blockquote className="viz-src">{text.length > 220 ? text.slice(0, 220) + "…" : text}</blockquote>
      <div className="row viz-tabs" role="tablist" aria-label="Kind of visual">
        <button role="tab" aria-selected={mode === "infographic"} className={"chip" + (mode === "infographic" ? " on" : "")} onClick={() => pick("infographic")}>Infographic layouts</button>
        <button role="tab" aria-selected={mode === "labelled"} className={"chip" + (mode === "labelled" ? " on" : "")} onClick={() => pick("labelled")}>🏷 Labelled diagram</button>
      </div>
      {labSeen && <div hidden={mode !== "labelled"}><LabelledPanel text={text} topic={topic} initial={initial?.mode === "labelled" ? initial : undefined} onInsert={onInsert} /></div>}
      {mode === "infographic" && <>
      {busy && <div className="viz-wait" role="status"><span className="spinner" /> Reading your text and picking layouts… {secs}s{secs > 12 ? " (the AI is slower than usual)" : ""}</div>}
      {err && <div className="err">{err} <button className="btn sm mint" onClick={generate}>Try again</button></div>}
      {fallback && !busy && <div className="banner">The AI isn't answering, so this is a basic layout of your own sentences. {aiErr && <small className="muted">({aiErr})</small>} <button className="btn sm mint" onClick={generate}>Try the AI again</button></div>}
      {spec && !busy && cur && <div className="viz-body">
        <div className="viz-gallery" role="listbox" aria-label="Layouts">{thumbs.map((t) => <button key={t.k} role="option" aria-selected={t.k === cur.k} className={"viz-thumb" + (t.k === cur.k ? " on" : "")} onClick={() => setKind(t.k)}>
          <img src={t.v.src} alt="" /><span>{KIND_LABEL[t.k]}</span></button>)}</div>
        <div className="viz-main">
          <div className="viz-preview"><img src={cur.v.src} alt={cur.v.alt} /></div>
          <div className="viz-controls">
            <div className="row"><span className="muted">Style</span>{THEMES.map((t) => <button key={t.id} className={"chip" + (t.id === theme ? " on" : "")} onClick={() => setTheme(t.id)}>{t.name}</button>)}</div>
            <div className="row"><span className="muted">Colours</span>{PALETTES.map((p) => <button key={p.id} className={"pal" + (p.id === pal ? " on" : "")} onClick={() => setPal(p.id)} aria-label={p.name} title={p.name}>{p.solid.slice(0, 4).map((c) => <i key={c} style={{ background: c }} />)}</button>)}
              <label className="muted"><input type="checkbox" checked={title} onChange={(e) => setTitle(e.target.checked)} /> Title</label></div>
            <button className="btn sm ghost" onClick={() => setEdit(!edit)} aria-expanded={edit}>{edit ? "Hide wording & icons" : "Edit wording & icons"}</button>
            {edit && <div className="viz-edit">{spec.nodes.map((n, i) => <div className="row" key={n.id}>
              <input className="ic" value={n.icon || ""} maxLength={4} onChange={(e) => patchNode(i, { icon: e.target.value })} aria-label={"Icon " + (i + 1)} placeholder="🙂" />
              <input className="grow" value={n.label} onChange={(e) => patchNode(i, { label: e.target.value })} aria-label={"Label " + (i + 1)} />
              <input className="grow" value={n.detail || ""} onChange={(e) => patchNode(i, { detail: e.target.value })} aria-label={"Detail " + (i + 1)} placeholder="detail" />
              <button className="btn sm ghost" disabled={spec.nodes.length <= 2} onClick={() => setSpec({ ...spec, nodes: spec.nodes.filter((_, j) => j !== i) })} aria-label={"Remove " + n.label}>✕</button></div>)}
              <button className="btn sm ghost" disabled={spec.nodes.length >= 12} onClick={() => setSpec({ ...spec, nodes: [...spec.nodes, { id: "n" + Date.now(), label: "New item", detail: "", icon: "", group: spec.nodes[spec.nodes.length - 1]?.group || "", parent: "" }] })}>+ Add item</button></div>}
          </div>
          <div className="row viz-foot"><button className="btn blue" onClick={() => onInsert(cur.v)}>Insert into sheet</button><button className="btn ghost" onClick={generate}>Regenerate</button><span className="muted">Drag it anywhere on the sheet afterwards; drag a corner to resize.</span></div>
        </div>
      </div>}
      </>}
    </div>
  </div>;
}
