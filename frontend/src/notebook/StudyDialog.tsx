import { useEffect, useRef, useState } from "react";
import { api, speak, stopSpeaking } from "../api";
import { escHtml } from "./editing";

export type StudyMode = "quiz" | "flashcards" | "gaps";
type Scope = "note" | "sheet";
type Quiz = { more?: boolean; questions: { q: string; options: string[]; answer: number; explanation: string; sheet: number | null }[]; title: string };
type Cards = { more?: boolean; cards: { front: string; back: string; sheet: number | null }[]; title: string };
type Gaps = { topic: string; verdict: string; covered: string[]; missing: { topic: string; why: string; add: string }[]; unclear: { point: string; fix: string }[] };
type P = { noteId: number; sheetIndex: number; sheetCount: number; initialMode: StudyMode; initialScope: Scope; voice?: string; onAddSheet: (html: string) => void; onAddNote: (label: string, html: string) => void; onGoToSheet: (i: number) => void; onClose: () => void };
/** Study output as the inside of a Companion note box. */
function noteFor(mode: StudyMode, d: any): [string, string] {
  if (mode === "quiz") return [`Quiz: ${d.title}`, `<ol>${(d as Quiz).questions.map((q) => `<li><b>${escHtml(q.q)}</b><br>✓ ${escHtml(q.options[q.answer])}${q.explanation ? ` <i>(${escHtml(q.explanation)})</i>` : ""}</li>`).join("")}</ol>`];
  if (mode === "flashcards") return [`Flashcards: ${d.title}`, `<ul>${(d as Cards).cards.map((c) => `<li><b>${escHtml(c.front)}</b>: ${escHtml(c.back)}</li>`).join("")}</ul>`];
  const g = d as Gaps; return [`What's missing: ${g.topic}`, `${g.verdict ? `<p>${escHtml(g.verdict)}</p>` : ""}<ul>${g.missing.map((m) => `<li><b>${escHtml(m.topic)}</b>: ${escHtml(m.add || m.why)}</li>`).join("")}</ul>`];
}
const FIRST: Record<StudyMode, number> = { quiz: 3, flashcards: 5, gaps: 0 }, MORE: Record<StudyMode, number> = { quiz: 5, flashcards: 7, gaps: 0 };
const LABEL: Record<StudyMode, string> = { quiz: "Quiz me", flashcards: "Flashcards", gaps: "What did I miss?" };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default function StudyDialog({ noteId, sheetIndex, sheetCount, initialMode, initialScope, voice, onAddSheet, onAddNote, onGoToSheet, onClose }: P) {
  const [mode, setMode] = useState<StudyMode>(initialMode), [scope, setScope] = useState<Scope>(initialScope), [noted, setNoted] = useState<Set<any>>(new Set());
  const [data, setData] = useState<Record<string, any>>({}), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [secs, setSecs] = useState(0), run = useRef(0), closeBtn = useRef<HTMLButtonElement>(null);
  const key = mode + ":" + scope, cur = data[key];
  /** Quizzes and flashcards arrive in two parts: a few right away (a few seconds), the rest while the student is already answering. */
  const load = async (force = false) => {
    if (!force && data[key]) return; const my = ++run.current, m = mode, k = key; setBusy(true); setErr(""); setSecs(0); const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 95000);
    const field = m === "quiz" ? "questions" : m === "flashcards" ? "cards" : "", first = FIRST[m], more = MORE[m], gen = Date.now();
    const ask = (count: number, avoid: string[] = []) => api("/study/generate", { json: { note_id: noteId, mode: m, scope, sheet_index: sheetIndex, count: count || undefined, avoid }, signal: ctl.signal });
    let r: any;
    try { r = await ask(first); if (my !== run.current) return; setData((d) => ({ ...d, [k]: { ...r, gen, more: !!more } })); }
    catch (e: any) { if (my === run.current) setErr(e.name === "AbortError" ? "This is taking too long. Please try again." : e.message); clearTimeout(t); if (my === run.current) setBusy(false); return; }
    setBusy(false);
    if (!more || !field) { clearTimeout(t); return; }
    const label = (x: any) => String(x.q || x.front || "").toLowerCase().trim();
    try {
      const r2 = await ask(more, r[field].map((x: any) => x.q || x.front)); if (my !== run.current) return;
      setData((d) => { const c = d[k]; if (!c || c.gen !== gen) return d; const seen = new Set(c[field].map(label)); return { ...d, [k]: { ...c, [field]: [...c[field], ...r2[field].filter((x: any) => !seen.has(label(x)))], more: false } }; });
    } catch { setData((d) => (d[k]?.gen === gen ? { ...d, [k]: { ...d[k], more: false } } : d)); } finally { clearTimeout(t); }
  };
  useEffect(() => { load(); }, [key]);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);
  useEffect(() => { closeBtn.current?.focus(); const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => { window.removeEventListener("keydown", k); stopSpeaking(); run.current++; }; }, []);
  return <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="modal study" role="dialog" aria-modal="true" aria-label="Study">
      <div className="row viz-head"><h2 className="grow">🎓 Study</h2>
        {!busy && cur && (mode !== "gaps" || cur.missing?.length > 0) && <button className="btn sm mint" disabled={noted.has(cur)} title={`Put this ${mode === "quiz" ? "quiz (with answers)" : mode === "flashcards" ? "set of flashcards" : "review"} into sheet ${sheetIndex + 1} as a small boxed note`}
          onClick={() => { const [l, h] = noteFor(mode, cur); onAddNote(l, h); setNoted(new Set([...noted, cur])); }}>{noted.has(cur) ? "Added to notes ✓" : "📌 Add to notes"}</button>}
        <button ref={closeBtn} className="btn sm ghost" onClick={onClose}>Close</button></div>
      <div className="row viz-tabs" role="tablist">
        {(Object.keys(LABEL) as StudyMode[]).map((m) => <button key={m} role="tab" aria-selected={m === mode} className={"chip" + (m === mode ? " on" : "")} onClick={() => setMode(m)}>{LABEL[m]}</button>)}
        <span className="grow" />
        <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="What to study"><option value="note">Whole notebook ({sheetCount} sheet{sheetCount === 1 ? "" : "s"})</option><option value="sheet">Only sheet {sheetIndex + 1}</option></select>
      </div>
      {busy && <div className="viz-wait" role="status"><span className="spinner" /> Reading your notes and preparing {mode === "quiz" ? "questions" : mode === "flashcards" ? "flashcards" : "a review"}… {secs}s</div>}
      {err && <div className="err">{err} <button className="btn sm mint" onClick={() => load(true)}>Try again</button></div>}
      {!busy && cur && mode === "quiz" && <QuizView key={cur.gen} data={cur as Quiz} voice={voice} onGoToSheet={(i) => { onGoToSheet(i); onClose(); }} onNew={() => load(true)} />}
      {!busy && cur && mode === "flashcards" && <CardsView key={cur.gen} data={cur as Cards} onNew={() => load(true)} />}
      {!busy && cur && mode === "gaps" && <GapsView data={cur as Gaps} onAddSheet={onAddSheet} onAddNote={onAddNote} onNew={() => load(true)} />}
    </div>
  </div>;
}

function QuizView({ data, voice, onGoToSheet, onNew }: { data: Quiz; voice?: string; onGoToSheet: (i: number) => void; onNew: () => void }) {
  const [qs, setQs] = useState(data.questions), [i, setI] = useState(0), [pick, setPick] = useState<number | null>(null), [missed, setMissed] = useState<number[]>([]), [right, setRight] = useState(0), [done, setDone] = useState(false);
  const [base, setBase] = useState(true), q = qs[i];
  useEffect(() => { if (base) setQs((x) => (data.questions.length > x.length ? [...x, ...data.questions.slice(x.length)] : x)); }, [data.questions.length]);
  useEffect(() => { if (!q && !data.more && !done && i > 0) setDone(true); }, [q, data.more]);
  const choose = (n: number) => { if (pick !== null || !q) return; setPick(n); if (n === q.answer) setRight((r) => r + 1); else setMissed((m) => [...m, i]); };
  const next = () => { if (i + 1 >= qs.length && !(base && data.more)) setDone(true); else { setI(i + 1); setPick(null); stopSpeaking(); } };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (done || (e.target as HTMLElement)?.tagName === "SELECT") return; const n = "1234".indexOf(e.key) >= 0 ? +e.key - 1 : "abcd".indexOf(e.key.toLowerCase()); if (n >= 0 && n < 4 && e.key.length === 1) choose(n); else if ((e.key === "Enter" || e.key === "ArrowRight") && pick !== null) next(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const retry = () => { setBase(false); setQs(shuffle(missed.map((m) => qs[m]))); setI(0); setPick(null); setMissed([]); setRight(0); setDone(false); };
  const [reading, setReading] = useState(false), [readErr, setReadErr] = useState("");
  const say = () => {
    if (reading) { stopSpeaking(); setReading(false); return; }
    setReadErr(""); setReading(true);
    speak(`${q.q}. ${q.options.map((o, k) => "ABCD"[k] + ". " + o).join(". ")}${pick !== null ? `. The answer is ${"ABCD"[q.answer]}. ${q.explanation}` : ""}`, voice)
      .catch((e: any) => setReadErr(e.message)).finally(() => setReading(false));
  };
  if (!q && !done) return <div className="study-body"><div className="viz-wait" role="status"><span className="spinner" /> {right} of {i} right so far. Getting the next questions…</div></div>;
  if (done) return <div className="study-body">
    <h3>{right} / {qs.length} correct</h3><p className="muted">{right === qs.length ? "Perfect. Nothing to revise here." : missed.length + " to review:"}</p>
    {missed.map((m) => <div key={m} className="study-miss"><b>{qs[m].q}</b><div>✓ {qs[m].options[qs[m].answer]}</div><small className="muted">{qs[m].explanation}</small>{qs[m].sheet ? <div><button className="btn sm ghost" onClick={() => onGoToSheet(qs[m].sheet! - 1)}>Go to sheet {qs[m].sheet}</button></div> : null}</div>)}
    <div className="row viz-foot">{missed.length > 0 && <button className="btn blue" onClick={retry}>Retry the {missed.length} I missed</button>}<button className="btn ghost" onClick={onNew}>New quiz</button></div></div>;
  return <div className="study-body">
    <div className="row"><span className="muted">Question {i + 1} of {qs.length}{base && data.more ? "+ (more coming)" : ""}</span><span className="grow" /><button className="btn sm ghost" onClick={say} aria-pressed={reading} aria-label={reading ? "Stop reading" : "Read the question aloud"}>{reading ? "■ Stop" : "🔊 Read aloud"}</button></div>
    {readErr && <div className="err" onClick={() => setReadErr("")}>{readErr}</div>}
    <div className="study-prog"><i style={{ width: `${(i / qs.length) * 100}%` }} /></div>
    <h3 className="study-q">{q.q}</h3>
    <div className="study-opts">{q.options.map((o, n) => <button key={n} className={"study-opt" + (pick !== null ? (n === q.answer ? " right" : n === pick ? " wrong" : " dim") : "")} onClick={() => choose(n)} disabled={pick !== null} aria-label={`Option ${"ABCD"[n]}: ${o}`}><b>{"ABCD"[n]}</b> {o}</button>)}</div>
    {pick !== null && <div className={"study-exp " + (pick === q.answer ? "ok" : "no")} role="status"><b>{pick === q.answer ? "Correct!" : "Not quite."}</b> {q.explanation}</div>}
    <div className="row viz-foot">{pick !== null ? <button className="btn blue" onClick={next} autoFocus>{i + 1 >= qs.length ? "See my score" : "Next question"}</button> : <span className="muted">Press A–D or 1–4 to answer</span>}</div>
  </div>;
}

function CardsView({ data, onNew }: { data: Cards; onNew: () => void }) {
  const [deck, setDeck] = useState(data.cards), [i, setI] = useState(0), [flip, setFlip] = useState(false), [again, setAgain] = useState<number[]>([]), [known, setKnown] = useState(0), [done, setDone] = useState(false);
  const [base, setBase] = useState(true), c = deck[i];
  useEffect(() => { if (base) setDeck((x) => (data.cards.length > x.length ? [...x, ...data.cards.slice(x.length)] : x)); }, [data.cards.length]);
  const go = (d: number) => { setFlip(false); setI(Math.max(0, Math.min(deck.length - 1, i + d))); };
  const mark = (ok: boolean) => { if (ok) setKnown((k) => k + 1); else setAgain((a) => [...a, i]); setFlip(false); if (i + 1 >= deck.length) setDone(true); else setI(i + 1); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (done || (e.target as HTMLElement)?.tagName === "SELECT") return; if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlip((f) => !f); } else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (flip && e.key === "1") mark(false); else if (flip && e.key === "2") mark(true); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const restart = (cards: typeof deck) => { setBase(false); setDeck(cards); setI(0); setFlip(false); setAgain([]); setKnown(0); setDone(false); };
  if (done) return <div className="study-body"><h3>{known} of {deck.length} known</h3><p className="muted">{again.length ? `${again.length} card${again.length === 1 ? "" : "s"} to go again.` : "You knew them all."}</p>
    <div className="row viz-foot">{again.length > 0 && <button className="btn blue" onClick={() => restart(again.map((a) => deck[a]))}>Review the {again.length} I missed</button>}<button className="btn ghost" onClick={() => restart(shuffle(data.cards))}>Shuffle all again</button><button className="btn ghost" onClick={onNew}>New cards</button></div></div>;
  return <div className="study-body">
    <div className="row"><span className="muted">Card {i + 1} of {deck.length}</span><span className="grow" /><button className="btn sm ghost" onClick={() => restart(shuffle(deck))}>Shuffle</button></div>
    <div className="study-prog"><i style={{ width: `${(i / deck.length) * 100}%` }} /></div>
    <button className={"flash" + (flip ? " back" : "")} onClick={() => setFlip(!flip)} aria-label={flip ? "Answer. Click to see the question" : "Question. Click to see the answer"}><small>{flip ? "ANSWER" : "QUESTION"}</small><span>{flip ? c.back : c.front}</span></button>
    <div className="row viz-foot">{flip ? <><button className="btn coral" onClick={() => mark(false)}>Again (1)</button><button className="btn mint" onClick={() => mark(true)}>Got it (2)</button></>
      : <><button className="btn ghost" disabled={i === 0} onClick={() => go(-1)}>‹ Back</button><button className="btn blue" onClick={() => setFlip(true)}>Show answer</button><button className="btn ghost" disabled={i + 1 >= deck.length} onClick={() => go(1)}>Skip ›</button></>}
      <span className="muted">Space flips · ← → moves</span></div>
  </div>;
}

function GapsView({ data, onAddSheet, onAddNote, onNew }: { data: Gaps; onAddSheet: (html: string) => void; onAddNote: (label: string, html: string) => void; onNew: () => void }) {
  const [added, setAdded] = useState<Set<number>>(new Set()), [boxed, setBoxed] = useState<Set<number>>(new Set());
  const html = (m: Gaps["missing"][0]) => `<h2>${escHtml(m.topic)}</h2><p>${escHtml(m.add || m.why)}</p>`;
  return <div className="study-body">
    <h3>{data.topic}</h3><p>{data.verdict}</p>
    {data.covered.length > 0 && <div className="row"><span className="muted">Well covered:</span>{data.covered.map((c, i) => <span key={i} className="chip mint">{c}</span>)}</div>}
    <h3>Missing from your notes</h3>
    {!data.missing.length && <p className="muted">Nothing important seems to be missing. Nice.</p>}
    {data.missing.map((m, i) => <div key={i} className="study-miss"><b>{m.topic}</b><div>{m.why}</div>{m.add && <small className="muted">{m.add}</small>}
      <div><button className="btn sm mint" disabled={added.has(i)} onClick={() => { onAddSheet(html(m)); setAdded(new Set([...added, i])); }}>{added.has(i) ? "Added ✓" : "+ Add to a new sheet"}</button>{" "}
        <button className="btn sm ghost" disabled={boxed.has(i)} onClick={() => { onAddNote(m.topic, `<p>${escHtml(m.add || m.why)}</p>`); setBoxed(new Set([...boxed, i])); }}>{boxed.has(i) ? "In your notes ✓" : "📌 Add here as a note box"}</button></div></div>)}
    {data.unclear.length > 0 && <><h3>Check these</h3>{data.unclear.map((u, i) => <div key={i} className="study-miss"><b>“{u.point}”</b><div>{u.fix}</div></div>)}</>}
    <div className="row viz-foot">{data.missing.length > 1 && <button className="btn blue" disabled={added.size === data.missing.length} onClick={() => { onAddSheet(data.missing.map(html).join("")); setAdded(new Set(data.missing.map((_, i) => i))); }}>Add all missing points as one sheet</button>}<button className="btn ghost" onClick={onNew}>Check again</button></div>
  </div>;
}
