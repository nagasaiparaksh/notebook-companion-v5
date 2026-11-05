import { useRef, useState, useEffect } from "react";

/** Decode any recorded blob and re-encode as 16 kHz mono 16-bit WAV. The backend can then split/send it to Gnani without ffmpeg. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ac = new AC(); let decoded: AudioBuffer;
  try { decoded = await ac.decodeAudioData(await blob.arrayBuffer()); } finally { ac.close().catch(() => {}); }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2)); const W = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  W(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); W(8, "WAVE"); W(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); W(36, "data"); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}

type StartOpts = { autoStop?: boolean; onAutoStop?: () => void };
export function useRecorder() {
  const [state, setState] = useState<"idle" | "rec" | "paused">("idle"); const [secs, setSecs] = useState(0);
  const mr = useRef<MediaRecorder | null>(null), chunks = useRef<Blob[]>([]), stream = useRef<MediaStream | null>(null), timer = useRef<any>(0), vad = useRef<any>(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null); const ctx = useRef<AudioContext | null>(null);
  const tick = () => { clearInterval(timer.current); timer.current = setInterval(() => setSecs((s) => s + 1), 1000); };
  const cleanup = () => { clearInterval(timer.current); clearInterval(vad.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; ctx.current?.close().catch(() => {}); ctx.current = null; setAnalyser(null); setState("idle"); };
  useEffect(() => cleanup, []);
  async function start(opts: StartOpts = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio (needs HTTPS or localhost).");
    let s: MediaStream; try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { throw new Error("Microphone permission was denied. Allow it in the address bar and try again."); }
    stream.current = s; chunks.current = []; setSecs(0);
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)(); ctx.current = ac; const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(s).connect(an); setAnalyser(an);
    const m = new MediaRecorder(s); mr.current = m; m.ondataavailable = (e) => e.data.size && chunks.current.push(e.data); m.start(500); setState("rec"); tick();
    if (opts.autoStop) { // stop ~1.4 s after the person stops talking (or after 9 s of silence)
      const buf = new Uint8Array(an.fftSize); let heard = 0, lastVoice = Date.now(); const t0 = Date.now();
      clearInterval(vad.current);
      vad.current = setInterval(() => {
        an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.025) { heard++; lastVoice = Date.now(); }
        const silentFor = Date.now() - lastVoice;
        if ((heard > 3 && silentFor > 1400) || (heard <= 3 && Date.now() - t0 > 9000) || Date.now() - t0 > 55000) { clearInterval(vad.current); opts.onAutoStop?.(); }
      }, 100);
    }
  }
  const pause = () => { mr.current?.pause(); clearInterval(timer.current); setState("paused"); };
  const resume = () => { mr.current?.resume(); tick(); setState("rec"); };
  const stop = () => new Promise<Blob>((res) => { const m = mr.current!; clearInterval(vad.current); m.onstop = () => { const b = new Blob(chunks.current, { type: m.mimeType || "audio/webm" }); cleanup(); res(b); }; m.stop(); });
  /** Short voice questions/commands: returns 16 kHz mono WAV (falls back to the raw recording if the browser can't decode it). */
  const stopWav = async () => { const raw = await stop(); try { return await blobToWav16k(raw); } catch { return raw; } };
  const discard = () => { if (mr.current && mr.current.state !== "inactive") { mr.current.onstop = null; mr.current.stop(); } chunks.current = []; setSecs(0); cleanup(); };
  return { state, secs, analyser, start, pause, resume, stop, stopWav, discard };
}
export function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, g = c.getContext("2d")!; let raf = 0; const buf = new Uint8Array(analyser?.fftSize || 1024);
    const draw = () => {
      g.clearRect(0, 0, c.width, c.height); g.lineWidth = 3; g.strokeStyle = "#3B5BDB"; g.lineCap = "round"; g.beginPath();
      if (analyser && active) { analyser.getByteTimeDomainData(buf); buf.forEach((v, i) => { const x = (i / buf.length) * c.width, y = (v / 255) * c.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }); }
      else { g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2); }
      g.stroke(); raf = requestAnimationFrame(draw);
    }; draw(); return () => cancelAnimationFrame(raf);
  }, [analyser, active]);
  return <canvas ref={ref} width={700} height={90} style={{ width: "100%", maxWidth: 700, height: 90 }} />;
}
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
