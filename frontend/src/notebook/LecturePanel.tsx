import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { createLectureRecorder, LiveInfo } from "../lecture";

export type LectureNotes = { title: string; say: string; blocks: any[]; key_terms: { term: string; meaning: string }[]; follow_up: string[] };
type P = { onState?: (s: string) => void; noteId: number; language: string; languageName: string; terms: string[]; hasMaterial: boolean; onBeforeStart: () => void; onNotes: (r: LectureNotes, transcript: string, keepTranscript: boolean) => void; onClose: () => void };
type Saved = { parts: string[]; langs?: string[]; seconds: number; at: number };
const key = (id: number) => `lecture-${id}`;
const fmt = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const load = (id: number): Saved | null => { try { const s = JSON.parse(localStorage.getItem(key(id)) || "null"); return s && Array.isArray(s.parts) ? s : null; } catch { return null; } };
const LANG: Record<string, string> = { "bn-IN": "Bengali", "en-IN": "English", "gu-IN": "Gujarati", "hi-IN": "Hindi", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu" };

/** Live lecture mode: Gnani transcribes the class as it happens (live captions), then the AI turns it into organized notes.
 *  A recorded lecture (phone voice memo) can be uploaded instead: Gnani Batch transcribes it and labels who spoke. */
export default function LecturePanel({ onState, noteId, language, languageName, terms, hasMaterial, onBeforeStart, onNotes, onClose }: P) {
  const saved = useRef(load(noteId));
  const [state, setState] = useState<"idle" | "recording" | "paused" | "stopped" | "uploading">(saved.current?.parts.some(Boolean) ? "stopped" : "idle");
  const [parts, setParts] = useState<string[]>(saved.current?.parts || []), [langs, setLangs] = useState<string[]>(saved.current?.langs || []), [seconds, setSeconds] = useState(saved.current?.seconds || 0), [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<{ i: number; wav: Blob }[]>([]), [err, setErr] = useState(""), [edited, setEdited] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(true), [notesLang, setNotesLang] = useState("English"), [lvl, setLvl] = useState(0), [mode, setMode] = useState<"" | "live" | "pieces">(""), [info, setInfo] = useState<LiveInfo | null>(null), [why, setWhy] = useState("");
  const [upMsg, setUpMsg] = useState(""), [recovered] = useState(!!saved.current?.parts.some(Boolean));
  const rec = useRef<ReturnType<typeof createLectureRecorder> | null>(null), queue = useRef<Promise<void>>(Promise.resolve()), nextIdx = useRef(saved.current?.parts.length || 0), endRef = useRef<HTMLDivElement>(null), pick = useRef<HTMLInputElement>(null);
  const partsRef = useRef(parts); partsRef.current = parts;
  const text = (edited ?? parts.filter(Boolean).join(" ")).trim(), words = text ? text.split(/\s+/).length : 0;

  useEffect(() => { try { if (parts.some(Boolean)) localStorage.setItem(key(noteId), JSON.stringify({ parts, langs, seconds, at: Date.now() })); } catch {} }, [parts, seconds]);
  useEffect(() => { if (state !== "recording") return; const t = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(t); }, [state]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [parts.length]);
  useEffect(() => () => { void rec.current?.stop(); onState?.("idle"); }, []);
  useEffect(() => { onState?.(state === "uploading" ? "idle" : state); }, [state]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (rec.current) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, []);

  const add = (t: string, lang: string) => { const i = nextIdx.current++; setParts((p) => { const n = [...p]; n[i] = t; return n; }); setLangs((l) => { const n = [...l]; n[i] = lang; return n; }); };
  /** pieces mode: each ~25 s piece goes to Gnani REST, with the course terms and what was just said as context */
  const transcribe = (i: number, wav: Blob) => {
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      const fd = new FormData(); fd.append("audio", wav, "lecture.wav"); fd.append("language", language); fd.append("note_id", String(noteId)); fd.append("source", "lecture");
      fd.append("terms", JSON.stringify(terms)); fd.append("previous_text", partsRef.current.filter(Boolean).join(" ").slice(-600));
      try { const r = await api("/audio/transcribe", { method: "POST", body: fd }); setParts((p) => { const n = [...p]; n[i] = (r.transcript || "").trim(); return n; }); setLangs((l) => { const n = [...l]; n[i] = r.language || ""; return n; }); }
      catch (e: any) { if (!/too short|no speech/i.test(e.message)) { setFailed((f) => [...f, { i, wav }]); setErr("A part couldn't be transcribed: " + e.message + " It is kept, so you can retry it."); } }
      finally { setPending((n) => n - 1); }
    });
  };
  async function start() {
    setErr(""); onBeforeStart(); setEdited(null); setMode(""); setInfo(null); setWhy("");
    const r = createLectureRecorder({
      language, noteId, terms,
      onSegment: (wav) => { const i = nextIdx.current++; setParts((p) => { const n = [...p]; n[i] = n[i] || ""; return n; }); transcribe(i, wav); },
      onLive: add,
      onMode: (m, inf, w) => { setMode(m); if (inf) setInfo(inf); if (w) setWhy(w); },
      onLevel: (x) => setLvl(Math.min(1, x * 14)),
      onLost: (w) => { setErr(`${w} Your transcript so far is safe: press Continue to keep recording.`); void stop(); }, onWarn: (m) => setErr(m),
    });
    try { await r.start(); rec.current = r; setState("recording"); } catch (e: any) { setErr(e.message); }
  }
  const pause = () => { rec.current?.pause(); setState("paused"); };
  const resume = () => { rec.current?.resume(); setState("recording"); };
  async function stop() { const r = rec.current; rec.current = null; await r?.stop(); setState("stopped"); setLvl(0); }
  const retry = () => { const f = failed; setFailed([]); setErr(""); f.forEach(({ i, wav }) => transcribe(i, wav)); };
  async function upload(f: File) {
    setErr(""); setState("uploading"); setUpMsg(`Uploading “${f.name}” to Gnani…`);
    try {
      const fd = new FormData(); fd.append("file", f); fd.append("language", language); fd.append("note_id", String(noteId)); fd.append("terms", JSON.stringify(terms));
      const { job_id } = await api("/lecture/upload", { method: "POST", body: fd }); const t0 = Date.now();
      for (;;) {
        setUpMsg(`Gnani is transcribing the recording and working out who spoke… ${Math.round((Date.now() - t0) / 1000)} s`);
        await new Promise((r) => setTimeout(r, 10000));                                  // Gnani asks for polling no faster than every 10 s
        const s = await api(`/lecture/upload/${job_id}`);
        if (s.error) throw new Error(s.error);
        if (s.status === "COMPLETED") {
          setParts((p) => [...p.filter(Boolean), s.transcript]); setLangs((l) => [...l, s.language || ""]); nextIdx.current = parts.filter(Boolean).length + 1;
          setSeconds((x) => x + Math.round(Number(s.duration) || 0)); setState("stopped");
          setUpMsg(s.speakers > 1 ? `Done: ${s.speakers} voices found (the teacher and ${s.speakers - 1} student${s.speakers > 2 ? "s" : ""}). Students' questions get their own section in the notes.` : "Done."); return;
        }
      }
    } catch (e: any) { setErr(e.message); setUpMsg(""); setState(parts.some(Boolean) ? "stopped" : "idle"); }
  }
  function discard() {
    if (!confirm("Throw away this lecture's transcript? (Notes you already made stay.)")) return;
    try { localStorage.removeItem(key(noteId)); } catch {} setParts([]); setLangs([]); setSeconds(0); setEdited(null); setFailed([]); nextIdx.current = 0; setState("idle"); setUpMsg("");
  }
  async function makeNotes() {
    if (pending) { setErr("Still transcribing the last part. One moment…"); return; }
    setBusy(true); setErr("");
    try {
      const r = await api("/lecture/notes", { json: { transcript: text, note_id: noteId, notes_language: notesLang === "same" ? "" : notesLang } });
      onNotes(r, text, keep); try { localStorage.removeItem(key(noteId)); } catch {}
      setParts([]); setLangs([]); setSeconds(0); setEdited(null); nextIdx.current = 0; setState("idle"); setUpMsg("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const rec_ = state === "recording" || state === "paused", seen = [...new Set(langs.filter(Boolean).map((l) => LANG[l] || l))];
  return <aside className="companion-drawer lecture" aria-label="Lecture mode">
    <div className="row"><b className="grow">🎙 Lecture mode</b><button className="btn sm ghost" onClick={onClose} disabled={rec_ || busy || state === "uploading"} title={rec_ ? "Stop recording first" : "Close"}>Close</button></div>
    {state === "idle" && <>
      <p className="muted" style={{ margin: 0, fontSize: 15 }}>Put your laptop or phone where it can hear the teacher and press Start. <b>Gnani</b> writes live captions as the class goes{hasMaterial ? ", listening out for your course's terms" : ""}; at the end, <b>Make notes</b> turns them into organized notes.</p>
      <small className="muted">Listening for: <b>{languageName}</b> (change it in ⚙ Settings)</small></>}
    {recovered && state === "stopped" && !upMsg && <div className="caption info">Recovered an unfinished lecture. Continue recording, or make notes from it.</div>}
    {mode && rec_ && <div className={"lec-mode " + mode} role="status">{mode === "live"
      ? <>🟢 Live captions · Gnani {info?.model || "Prisma v3"} · {languageName}{info?.keyterms ? ` · ${info.keyterms} course terms boosted` : ""}</>
      : <>🟡 Transcribing in ~25 s pieces{why ? ` (${why})` : ""}</>}</div>}
    <div className="lec-bar">
      <span className={"lec-dot" + (state === "recording" ? " on" : "")} style={{ ["--lvl" as any]: lvl }} aria-hidden />
      <b className="lec-time" aria-label="Recording time">{fmt(seconds)}</b>
      <span className="muted grow">{words} words{pending ? ` · transcribing ${pending}…` : ""}{seen.length ? ` · heard: ${seen.join(", ")}` : ""}</span>
      {state === "idle" && <button className="btn coral" onClick={() => void start()}>● Start</button>}
      {state === "recording" && <><button className="btn sm ghost" onClick={pause}>❚❚ Pause</button><button className="btn sm blue" onClick={() => void stop()}>■ Stop</button></>}
      {state === "paused" && <><button className="btn sm coral" onClick={resume}>● Resume</button><button className="btn sm blue" onClick={() => void stop()}>■ Stop</button></>}
      {state === "stopped" && <button className="btn sm ghost" onClick={() => void start()} title="Keep recording into the same transcript">● Continue</button>}
    </div>
    {(state === "idle" || state === "stopped") && <div className="row" style={{ flexWrap: "wrap" }}>
      <button className="btn sm ghost" onClick={() => pick.current?.click()} title="A voice memo or recording of the class, up to 10 MB">⬆ Upload a recording</button>
      <small className="muted">phone voice memo, up to 10 MB · Gnani labels the teacher and students</small>
      <input ref={pick} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.flac" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} /></div>}
    {state === "uploading" && <div className="caption info" role="status"><span className="spinner" /> {upMsg}</div>}
    {upMsg && state === "stopped" && <div className="caption ok">{upMsg}</div>}
    {state === "paused" && <small className="muted">Paused: nothing is recorded until you resume.</small>}
    {state === "recording" && <small className="muted">Keep this tab open. The screen stays awake while recording; you can still use other tabs.</small>}
    {err && <div className="err" onClick={() => setErr("")}>{err} {failed.length > 0 && <button className="btn sm mint" onClick={retry}>Retry {failed.length}</button>}</div>}
    {state === "stopped"
      ? <textarea className="lec-text" value={text} onChange={(e) => setEdited(e.target.value)} aria-label="Lecture transcript (you can fix it before making notes)" />
      : <div className="lec-text" aria-live="polite">{parts.map((p, i) => p ? <p key={i}>{langs[i] && langs[i] !== "en-IN" && <span className="chip lang">{LANG[langs[i]] || langs[i]}</span>}{p}</p> : null)}{rec_ && <p className="muted">{state === "recording" ? "Listening…" : ""}</p>}<div ref={endRef} /></div>}
    {state === "stopped" && <>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 4 }}>Notes in <select value={notesLang} onChange={(e) => setNotesLang(e.target.value)}><option>English</option><option>Hindi</option><option>Telugu</option><option>Tamil</option><option>Kannada</option><option>Malayalam</option><option>Marathi</option><option>Bengali</option><option value="same">the lecture's language</option></select></label>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> also keep the full transcript</label>
      </div>
      <div className="row"><button className="btn blue grow" disabled={busy || words < 25 || pending > 0} onClick={() => void makeNotes()}>{busy ? <><span className="spinner" /> Making notes… (a long lecture takes a minute)</> : "✦ Make notes"}</button><button className="btn sm ghost" onClick={discard} disabled={busy}>Discard</button></div>
      {words < 25 && <small className="muted">Record a bit more first: at least 25 words are needed to make notes.</small>}
    </>}
  </aside>;
}
