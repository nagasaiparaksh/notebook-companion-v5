import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { shrinkImage } from "./importing";

export type Material = { id: number; name: string; kind: string; summary: string; topics: string[]; terms: string[]; chars: number; pages?: number; pages_read?: number; created: number };
export type Coverage = { topics: { topic: string; status: "covered" | "partial" | "missing"; sheet: number | null; hint: string }[]; covered: number; partial: number; total: number; percent: number; method: string; checked: number };
type Cmp = { without: string; with: string; terms_without: string[]; terms_with: string[]; gained: string[]; lost: string[]; keyterms: number; context_used: boolean };
type P = { noteId: number; language: string; terms: string[]; items: Material[]; onChange: (items: Material[]) => void; onClose: () => void; coverage: Coverage | null; onCoverage: (c: Coverage) => void; onAddTopic: (topic: string, hint: string) => void; onGoToSheet: (i: number) => void };
const MARK = { covered: "✓", partial: "◐", missing: "✗" } as const;
const ICON: Record<string, string> = { pdf: "📄", word: "📝", slides: "📊", photo: "📷", text: "🗒" };
const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.markdown,.csv,image/*,application/pdf";
/** Real page/slide count when the file has pages; otherwise how much text there is (never a guessed page count). */
const size = (m: Material) => {
  const unit = m.kind === "slides" ? "slide" : "page", n = m.pages || 0, r = m.pages_read || 0;
  if (n) return `${n} ${unit}${n === 1 ? "" : "s"} · ${r >= n ? "all read" : `${r} of ${n} read`}`;
  return m.chars >= 1000 ? `${Math.round(m.chars / 1000)}k characters of text` : `${m.chars} characters of text`;
};

/** Course material for one notebook: syllabus, slides, a textbook chapter, handouts. The AI uses it to understand what the notebook is about. */
export default function MaterialsDialog({ noteId, language, terms, items, onChange, onClose, coverage, onCoverage, onAddTopic, onGoToSheet }: P) {
  // 🔬 the measurable benefit: Gnani transcribes the same clip with and without the course's terms
  const [cmp, setCmp] = useState<Cmp | null>(null), [cmpBusy, setCmpBusy] = useState(""), [cmpErr, setCmpErr] = useState("");
  async function runCompare() {
    setCmp(null); setCmpErr("");
    try {
      const { recordClip } = await import("../lecture");
      const wav = await recordClip(20, (s) => setCmpBusy(`Recording… ${s} s left. Read a few sentences from your material aloud.`));
      setCmpBusy("Gnani is transcribing it twice: with and without your course terms…");
      const fd = new FormData(); fd.append("audio", wav, "test.wav"); fd.append("language", language); fd.append("note_id", String(noteId)); fd.append("terms", JSON.stringify(terms));
      setCmp(await api("/audio/compare", { method: "POST", body: fd }));
    } catch (e: any) { setCmpErr(e.message); } finally { setCmpBusy(""); }
  }
  const mark = (text: string, hits: string[]) => { if (!hits.length) return text; const re = new RegExp(`(${hits.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi"); return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p)); };
  const [covBusy, setCovBusy] = useState(false), [covErr, setCovErr] = useState("");
  async function checkCoverage() { setCovBusy(true); setCovErr(""); try { onCoverage(await api(`/notes/${noteId}/coverage`, { method: "POST" })); } catch (e: any) { setCovErr(e.message); } finally { setCovBusy(false); } }
  const [busy, setBusy] = useState(""), [problems, setProblems] = useState<string[]>([]), [paste, setPaste] = useState(""), [pasteName, setPasteName] = useState(""), [drag, setDrag] = useState(false);
  const pick = useRef<HTMLInputElement>(null), closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeBtn.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [busy]);
  const refresh = async () => onChange(await api(`/notes/${noteId}/materials`));

  async function send(fd: FormData, label: string, probs: string[]) {
    try { const r = await api(`/notes/${noteId}/materials`, { method: "POST", body: fd }); (r.problems || []).forEach((p: string) => probs.push(`${label}: ${p}`)); }
    catch (e: any) { probs.push(`${label}: ${e.message}`); }
  }
  async function upload(files: File[]) {
    if (!files.length || busy) return; const probs: string[] = []; setProblems([]);
    for (const [i, f] of files.entries()) {
      setBusy(`Reading “${f.name}”${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}… long PDFs and photos take a little while`);
      const fd = new FormData(); fd.append("name", f.name);
      if (f.type.startsWith("image/")) { try { fd.append("file", await (await fetch(await shrinkImage(f))).blob(), f.name.replace(/\.[^.]+$/, "") + ".jpg"); } catch (e: any) { probs.push(e.message); continue; } }
      else fd.append("file", f);
      await send(fd, f.name, probs);
    }
    await refresh().catch(() => {}); setProblems(probs); setBusy(""); void checkCoverage();    // new topics: show how much of them the notes already cover
  }
  async function addPasted() {
    const t = paste.trim(); if (t.length < 40 || busy) return; const probs: string[] = [], name = pasteName.trim() || "Pasted text";
    setBusy("Reading the pasted text…"); const fd = new FormData(); fd.append("text", t); fd.append("name", name);
    await send(fd, name, probs); await refresh().catch(() => {}); setProblems(probs); if (probs.every((p) => /summar/i.test(p))) { setPaste(""); setPasteName(""); } setBusy("");   // keep the text if it wasn't saved
  }
  async function remove(m: Material) {
    if (!confirm(`Remove “${m.name}” from this notebook's course material? (Your notes are not touched.)`)) return;
    try { await api(`/materials/${m.id}`, { method: "DELETE" }); await refresh(); } catch (e: any) { setProblems([e.message]); }
  }

  return <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <div className="modal materials" role="dialog" aria-modal="true" aria-label="Course material">
      <div className="row viz-head"><h2 className="grow">📚 Course material</h2><button ref={closeBtn} className="btn sm ghost" onClick={onClose} disabled={!!busy}>Close</button></div>
      <p className="muted" style={{ marginTop: 0 }}>Add the syllabus, lecture slides, a textbook chapter or handouts for this notebook. The AI then knows what it is about: it fixes misheard terms when you dictate, answers and writes summaries and diagrams from your material, and “What did I miss?” compares your notes with it. Your notes themselves are never changed.</p>
      <div className={"mat-drop" + (drag ? " on" : "")} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(Array.from(e.dataTransfer.files)); }}>
        {busy ? <span role="status"><span className="spinner" /> {busy}</span> : <>
          <button className="btn blue" onClick={() => pick.current?.click()}>+ Add files</button>
          <span className="muted">or drop them here · PDF, Word (.docx), PowerPoint (.pptx), text / Markdown, photos of pages</span></>}
        <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; void upload(f); }} />
      </div>
      <details className="mat-paste"><summary>Or paste text (e.g. a syllabus from a website)</summary>
        <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="Name, e.g. “Course syllabus”" aria-label="Name for the pasted text" />
        <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the text here…" aria-label="Pasted course material" />
        <button className="btn sm mint" disabled={!!busy || paste.trim().length < 40} onClick={() => void addPasted()}>Add text</button>
      </details>
      {items.length > 0 && <section className="cov" aria-label="Syllabus coverage">
        <div className="row"><b className="grow">📊 Syllabus coverage</b>{coverage?.total ? <b className="cov-pct">{coverage.percent}%</b> : null}
          <button className="btn sm blue" disabled={covBusy} onClick={() => void checkCoverage()}>{covBusy ? <><span className="spinner" /> Checking…</> : coverage?.total ? "Check again" : "Check my notes"}</button></div>
        {coverage?.total ? <>
          <div className="cov-bar" role="progressbar" aria-valuenow={coverage.percent} aria-valuemin={0} aria-valuemax={100}><i className="c" style={{ width: `${(coverage.covered / coverage.total) * 100}%` }} /><i className="p" style={{ width: `${(coverage.partial / coverage.total) * 100}%` }} /></div>
          <small className="muted">{coverage.covered} covered · {coverage.partial} partly · {coverage.total - coverage.covered - coverage.partial} missing{coverage.method === "keywords" ? " · quick keyword check (the AI was unavailable)" : ""} · checked {new Date(coverage.checked * 1000).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small>
          <ul className="cov-list">{coverage.topics.map((t, i) => <li key={i} className={"cov-" + t.status}>
            <span className="cov-mark" aria-label={t.status}>{MARK[t.status]}</span>
            <span className="grow">{t.topic}{t.hint ? <small className="muted"> · {t.hint}</small> : null}</span>
            {t.sheet ? <button className="btn sm ghost" onClick={() => { onGoToSheet(t.sheet! - 1); onClose(); }}>sheet {t.sheet}</button> : null}
            {t.status !== "covered" && <button className="btn sm mint" onClick={() => { onAddTopic(t.topic, t.hint); onClose(); }} title="Write a short section on this from your course material">✍ Add notes</button>}
          </li>)}</ul></> : <small className="muted">See which topics of your course your notes already cover, and fill the gaps in one click.</small>}
        {covErr && <div className="err" onClick={() => setCovErr("")}>{covErr}</div>}
      </section>}
      {items.length > 0 && <section className="cov" aria-label="Accuracy test">
        <div className="row"><b className="grow">🔬 Does it hear your subject better?</b><button className="btn sm mint" disabled={!!cmpBusy} onClick={() => void runCompare()}>{cmpBusy ? <><span className="spinner" /> Testing…</> : "Record a 20 s test"}</button></div>
        {cmpBusy ? <small className="muted" role="status">{cmpBusy}</small> : !cmp && <small className="muted">Read a few sentences of your material aloud. Gnani transcribes them twice, with and without this notebook's course terms, so you can see the difference.</small>}
        {cmpErr && <div className="err" onClick={() => setCmpErr("")}>{cmpErr}</div>}
        {cmp && <>
          <div className="cmp-sum"><b>{cmp.terms_with.length}</b> course terms recognised with them vs <b>{cmp.terms_without.length}</b> without{cmp.gained.length ? <> · gained: {cmp.gained.map((g) => <span key={g} className="chip mint">{g}</span>)}</> : null}{!cmp.context_used && " · (Gnani didn't accept the context for this clip)"}</div>
          <div className="org-cols"><div><small className="muted">Without course terms</small><div className="org-page">{mark(cmp.without, cmp.terms_without)}</div></div><div><small className="muted">With {cmp.keyterms} course terms</small><div className="org-page after">{mark(cmp.with, cmp.terms_with)}</div></div></div>
        </>}
      </section>}
      {problems.length > 0 && <div className="err" onClick={() => setProblems([])}>{problems.map((p, i) => <div key={i}>{p}</div>)}</div>}
      {!items.length ? <p className="muted">Nothing added yet.</p> : <div className="mat-list">
        {items.map((m) => <div key={m.id} className="mat-item">
          <div className="row"><b className="grow">{ICON[m.kind] || "📎"} {m.name}</b><small className="muted">{size(m)}</small><button className="btn sm ghost" onClick={() => void remove(m)} disabled={!!busy} aria-label={`Remove ${m.name}`}>Remove</button></div>
          {m.summary && <div className="mat-sum">{m.summary}</div>}
          {m.topics.length > 0 && <div className="mat-topics">{m.topics.map((t, i) => <span key={i} className="chip">{t}</span>)}</div>}
        </div>)}
      </div>}
    </div>
  </div>;
}
