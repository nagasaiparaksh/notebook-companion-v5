import { useEffect, useRef, useState } from "react";
import { useApp } from "../ctx";
import { speak, stopSpeaking } from "../api";

const MODELS = [{ id: "timbre-v3.0", label: "Timbre v3.0 · 13 voices, all languages" }, { id: "timbre-v2.5", label: "Timbre v2.5 · 42 voices, one per language" }];
const get = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

/** ⚙ Settings: the notebook's language (passed in as children), plus reading voice, speed and voice model (saved in this browser). */
export default function VoiceSettings({ children }: { children?: React.ReactNode }) {
  const { status, voice, setVoice } = useApp();
  const [open, setOpen] = useState(false), [speed, setSpeed] = useState(() => Number(get("ttsSpeed", "1.15"))), [model, setModel] = useState(() => get("ttsModel", "") || status?.tts_model || "timbre-v3.0"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, [open]);
  const list: { name: string; gender: string; lang: string; desc: string }[] = status?.catalog?.[model] || [];
  const defaults = status?.default_voices || {};
  const pickModel = (m: string) => { setModel(m); put("ttsModel", m); const names = (status?.catalog?.[m] || []).map((v: any) => v.name); if (!names.includes(voice)) setVoice(defaults[m] || names[0]); };
  async function preview() {
    if (busy) { stopSpeaking(); setBusy(false); return; }
    setErr(""); setBusy(true);
    try { await speak("Hello! This is how I will read your notes aloud.", voice); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return <div className="vset" ref={box}>
    <button className="btn sm ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Settings: language, reading voice and speed" aria-label="Settings">⚙<span className="lbl"> Settings</span></button>
    {open && <div className="vset-pop" role="dialog" aria-label="Settings">
      {children}
      <label>Voice model<select value={model} onChange={(e) => pickModel(e.target.value)}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label>Voice<select value={voice} onChange={(e) => setVoice(e.target.value)}>{list.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.gender} · {v.lang}</option>)}</select>
        <span className="vset-ticks"><span>{list.find((v) => v.name === voice)?.desc || ""}</span></span></label>
      <label>Speed <b>{speed.toFixed(2).replace(/0$/, "")}×</b>
        <input type="range" min={0.85} max={1.5} step={0.05} value={speed} onChange={(e) => { const v = Number(e.target.value); setSpeed(v); put("ttsSpeed", String(v)); }} />
        <span className="vset-ticks"><span>0.85×</span><span>1×</span><span>1.5×</span></span></label>
      <button className="btn sm mint" onClick={() => void preview()}>{busy ? "■ Stop" : "▶ Preview"}</button>
      {err && <p className="vset-err">{err}</p>}
    </div>}
  </div>;
}
