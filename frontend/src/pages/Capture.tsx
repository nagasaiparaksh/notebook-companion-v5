import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp, LangSelect } from "../ctx";
import { useRecorder, Waveform, fmt } from "../recorder";

export default function Capture() {
  const nav = useNavigate(); const { lang } = useApp(); const r = useRecorder();
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [live, setLive] = useState(false);
  const recognition = useRef<any>(null), finalText = useRef("");
  const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  function startLive() {
    setErr("");
    if (!Speech) { setErr("Live transcription is not supported in this browser. Use Chrome or Edge, or record and transcribe with Gnani below."); return; }
    const rec = new Speech(); recognition.current = rec;
    rec.lang = lang || "en-IN"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText.current += part + " ";
        else interim += part;
      }
      setText((finalText.current + interim).trim());
    };
    rec.onerror = (event: any) => setErr(`Live transcription: ${event.error}. You can continue editing the transcript or use Gnani audio transcription.`);
    rec.onend = () => setLive(false);
    finalText.current = text ? text + " " : "";
    try { rec.start(); setLive(true); } catch { setErr("Could not start live transcription. Check microphone permission."); }
  }
  function stopLive() { try { recognition.current?.stop(); } catch {} setLive(false); }
  async function transcribe(b: Blob | File) {
    setBusy("Transcribing audio with Gnani…"); setErr("");
    try { const fd = new FormData(); fd.append("audio", b, (b as File).name || "rec.webm"); fd.append("language", lang);
      const j = await api("/audio/transcribe", { method: "POST", body: fd }); setText((t) => (t ? t + "\\n" : "") + j.transcript); }
    catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }
  async function make() {
    setBusy("Understanding what you said…"); setErr("");
    try {
      let intent: any = null;
      try { intent = await api("/notes/intent", { json: { text } }); } catch {}
      const diagramIntent = intent?.intent === "diagram" || /\\b(i want to see how|show me how|show me what|what does .+ look like|draw|generate (an? )?diagram|make (an? )?diagram|create (an? )?diagram)\\b/i.test(text);
      if (diagramIntent) {
        const n = await api("/notes", { json: { title: "Diagram request", content: "", language: lang, transcript: text } });
        nav(`/diagrams?prompt=${encodeURIComponent(intent?.diagram_prompt || text)}&noteId=${n.id}`);
      } else if (intent?.intent === "question") {
        nav(`/companion?q=${encodeURIComponent(text)}`);
      } else {
        const n = await api("/notes/process", { json: { text, language: lang } });
        nav("/notes?open=" + n.id);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }
  async function plain() {
    const n = await api("/notes", { json: { title: text.slice(0, 50), content: `<p>${text.replace(/\\n/g, "<br>")}</p>`, transcript: text, language: lang } });
    nav("/notes?open=" + n.id);
  }
  return <div className="col" style={{ width: "100%", maxWidth: 1050 }}>
    <h1>Live capture studio</h1>
    <div className="row"><LangSelect /><span className="muted">Speech appears in the transcript as you speak. Diagram requests such as “show me what an amoeba looks like” open the diagram studio.</span></div>
    <div className="sheet col" style={{ alignItems: "center" }}>
      <Waveform analyser={r.analyser} active={r.state === "rec"} />
      <div className="row">
        {!live ? <button className="rec" onClick={startLive}>🎙 Live</button> : <button className="rec live" onClick={stopLive}>■ Stop</button>}
        <span className="muted">{live ? "Listening and transcribing…" : "Live transcription ready"}</span>
      </div>
      <div className="row">
        {r.state === "idle" ? <button className="btn peach" onClick={() => r.start().catch((e:any)=>setErr(e.message))}>Record for Gnani STT</button>
          : <button className="btn coral" onClick={async()=>{try{await transcribe(await r.stop())}catch(e:any){setErr(e.message)}}}>Stop & transcribe with Gnani</button>}
        {r.state === "rec" && <button className="btn" onClick={r.pause}>Pause</button>}
        {r.state === "paused" && <button className="btn mint" onClick={r.resume}>Resume</button>}
        {r.state !== "idle" && <button className="btn ghost" onClick={r.discard}>Discard recording</button>}
        <label className="btn lav">Upload audio<input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && transcribe(e.target.files[0])} /></label>
      </div>
    </div>
    {busy && <div className="muted">{busy}</div>}{err && <div className="err">{err}</div>}
    <h2>Live transcript</h2>
    <textarea rows={16} value={text} onChange={(e) => { setText(e.target.value); finalText.current = e.target.value; }} placeholder="Your spoken words will appear here in real time. You can also type or edit them." />
    <div className="row"><button className="btn lav" disabled={!text.trim() || !!busy || live} onClick={make}>Make a structured note</button>
      <button className="btn mint" disabled={!text.trim() || !!busy || live} onClick={plain}>Save transcript as note</button></div>
  </div>;
}
