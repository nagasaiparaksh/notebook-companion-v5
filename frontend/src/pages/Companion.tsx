import { useEffect, useRef, useState } from "react"; import { Link, useSearchParams } from "react-router-dom"; import { api, speak, stopSpeaking, askStream } from "../api"; import { useApp, LangSelect } from "../ctx"; import { useRecorder, fmt } from "../recorder";
export default function Companion() {
  const [sp, setSp] = useSearchParams(); const { lang, voice } = useApp(); const rec = useRecorder();
  const [sessions, setSessions] = useState<any[]>([]), [sid, setSid] = useState<number | null>(sp.get("s") ? +sp.get("s")! : null), [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState(sp.get("q") || ""), [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [notes, setNotes] = useState<any[]>([]), [playing, setPlaying] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const load = (qq = q) => api("/chat/sessions?q=" + encodeURIComponent(qq)).then(setSessions).catch(() => {});
  useEffect(() => { load(); api("/notes").then(setNotes).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (sid) api(`/chat/sessions/${sid}/messages`).then(setMsgs).catch((e) => setErr(e.message)); else setMsgs([]); }, [sid]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);
  const [stream, setStream] = useState(""); const latest = useRef<any>({});
  async function send(t = text) {
    if (!t.trim() || busy) return; setErr(""); setBusy(true); setText(""); setStream(""); let id = sid, added = false;
    try { if (!id) { id = (await api("/chat/sessions", { json: {} })).id; setSid(id); }
      setMsgs((m) => [...m, { role: "user", content: t }]); added = true;
      const a = await askStream(id!, t, null, (d) => setStream((x) => x + d)); setMsgs((m) => [...m, { role: "assistant", content: a.content, sources: a.sources }]); setStream(""); load(); }
    catch (e: any) { setErr(e.message); setText(t); setStream(""); if (added) setMsgs((m) => m.slice(0, -1)); } finally { setBusy(false); }
  }
  async function finishVoice() {
    if (rec.state === "idle") return;
    try { const b = await rec.stopWav(); const fd = new FormData(); fd.append("audio", b, b.type.includes("wav") ? "q.wav" : "q.webm"); fd.append("language", lang);
      const j = await api("/audio/transcribe", { method: "POST", body: fd }); if (j.transcript?.trim()) await send(j.transcript); else setErr("I couldn't hear any words. Please try again."); } catch (e: any) { setErr(e.message); }
  }
  latest.current.finish = finishVoice;
  async function voiceIn() {
    setErr(""); try { if (rec.state === "idle") { stopSpeaking(); return await rec.start({ autoStop: true, onAutoStop: () => void latest.current.finish() }); } await finishVoice(); } catch (e: any) { setErr(e.message); }
  }
  async function listen(i: number, t: string) { if (playing === i) { stopSpeaking(); setPlaying(-1); return; } setPlaying(i); try { await speak(t, voice, () => setPlaying(-1)); } catch (e: any) { setErr(e.message); setPlaying(-1); } }
  const del = async (id: number) => { await api("/chat/sessions/" + id, { method: "DELETE" }); if (sid === id) setSid(null); load(); };
  const render = (t: string) => t.split(/(\[note:\d+\])/).map((p, i) => { const m = p.match(/\[note:(\d+)\]/); return m ? <Link key={i} className="chip" to={"/notes?open=" + m[1]}>from your notes</Link> : p; });
  const starters = notes.slice(0, 3).map((n) => `Explain "${n.title}" like I'm new to it`).concat(["What have I been studying lately?"]);
  return <div className="split">
    <aside className="col"><button className="btn mint" onClick={() => { setSid(null); setSp({}); }}>+ New conversation</button>
      <input placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div>{sessions.map((s) => <div key={s.id} className="row" style={{ gap: 0 }}><button className={"list-item grow" + (s.id === sid ? " on" : "")} onClick={() => setSid(s.id)}>{s.title}</button>
        <button className="btn sm ghost" aria-label="Delete chat" onClick={() => del(s.id)}>×</button></div>)}</div></aside>
    <main style={{ minHeight: "60vh" }}>
      {!msgs.length && <div><h1>Hey, what are we figuring out?</h1><p className="muted">I know your saved notes and can fill in the rest. I'll say which is which.</p>
        <div>{starters.map((s) => <button key={s} className="chip peach" style={{ cursor: "pointer", font: "inherit" }} onClick={() => send(s)}>{s}</button>)}</div></div>}
      {msgs.map((m, i) => <div key={i} className={"bubble " + (m.role === "user" ? "me" : "ai")}>{m.role === "user" ? m.content : render(m.content)}
        {m.role !== "user" && <div className="row" style={{ marginTop: 6 }}>{m.sources?.length > 0 && <span className="muted" style={{ fontSize: 15 }}>looked at:</span>}
          {m.sources?.map((s: any) => <Link key={s.id} className={"chip " + (s.cited ? "" : "mint")} to={"/notes?open=" + s.id}>{s.title}{s.cited ? " ✓" : ""}</Link>)}
          <button className="btn sm ghost" onClick={() => listen(i, m.content.replace(/\[note:\d+\]/g, ""))}>{playing === i ? "■ Stop" : "▶ Listen"}</button></div>}</div>)}
      {stream && <div className="bubble ai">{render(stream)}</div>}{busy && !stream && <div className="bubble ai muted">thinking…</div>}{err && <div className="err">{err}</div>}<div ref={end} />
      <div className="row" style={{ position: "sticky", bottom: 8, background: "rgba(255,255,255,.9)", padding: 8, borderRadius: 12 }}>
        <textarea rows={2} className="grow" value={text} placeholder="Ask anything… follow-ups work, I remember the thread" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="col" style={{ gap: 4 }}><button className="btn blue" disabled={busy || !text.trim()} onClick={() => send()}>Send</button>
          <button className={"btn " + (rec.state === "rec" ? "coral" : "lav")} onClick={voiceIn}>{rec.state === "rec" ? `■ ${fmt(rec.secs)}` : "🎙 Speak"}</button></div><LangSelect /></div>
    </main></div>;
}
