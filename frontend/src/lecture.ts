/**
 * Live lecture recorder.
 * - LIVE mode (default): 16 kHz PCM is streamed to our server, which relays it to Gnani's realtime STT (Prisma v3, with the
 *   course's keyterms); each sentence comes back as a caption about a second after it is spoken.
 * - PIECES mode (automatic fallback, e.g. if the live connection can't be opened or drops): audio is cut at natural pauses into
 *   ~20-28 s WAV pieces (Gnani's REST limit is 30 s) and each piece is uploaded for transcription.
 * The screen is kept awake, suspended audio is resumed, and a lost microphone is reported.
 */
import { WORKLET, encodeWav16k } from "./voice";

export type LiveInfo = { model: string; language: string; keyterms: number; topic: boolean };
export type LectureOpts = {
  language: string; noteId?: number; terms?: string[];
  onSegment: (wav: Blob, seconds: number) => void;                    // pieces mode
  onLive?: (text: string, language: string) => void;                  // live mode
  onMode?: (mode: "live" | "pieces", info?: LiveInfo, why?: string) => void;
  onLevel?: (rms: number) => void; onLost?: (why: string) => void; onWarn?: (msg: string) => void;
};

export function createLectureRecorder(o: LectureOpts) {
  let stream: MediaStream | null = null, ctx: AudioContext | null = null, node: AudioWorkletNode | null = null, paused = false, sr = 48000, stopping = false;
  let seg: Float32Array[] = [], segMs = 0, silentMs = 0, voicedMs = 0, noise = 0.006;
  let wake: any = null, lastAudio = Date.now(), watch: any = 0;
  let ws: WebSocket | null = null, mode: "live" | "pieces" = "pieces";
  // 16 kHz resampler state for the live stream (fractional position keeps 44.1 kHz sources in tune)
  let pos = 0, out16 = new Int16Array(512), n16 = 0;

  const lockScreen = async () => { try { if ((navigator as any).wakeLock && document.visibilityState === "visible") wake = await (navigator as any).wakeLock.request("screen"); } catch { o.onWarn?.("Couldn't keep the screen awake: change your sleep settings so the laptop doesn't sleep during the lecture."); } };
  const onVis = () => { if (document.visibilityState === "visible") { void lockScreen(); void ctx?.resume(); } };
  const emit = () => {
    const all = seg, vms = voicedMs; seg = []; segMs = 0; silentMs = 0; voicedMs = 0;
    if (!all.length || vms < 700) return;
    let len = 0; for (const c of all) len += c.length; const pcm = new Float32Array(len); let p = 0; for (const c of all) { pcm.set(c, p); p += c.length; }
    o.onSegment(encodeWav16k(pcm, sr), len / sr);
  };
  const pushLive = (chunk: Float32Array) => {
    const step = sr / 16000;
    for (; pos + step <= chunk.length; pos += step) {
      const a = Math.floor(pos), b = Math.max(a + 1, Math.floor(pos + step)); let s = 0; for (let j = a; j < b; j++) s += chunk[j];   // box filter: no aliasing hiss
      out16[n16++] = Math.max(-1, Math.min(1, s / (b - a))) * 0x7fff;
      if (n16 === 512) { if (ws?.readyState === 1) ws.send(out16.buffer.slice(0)); n16 = 0; }        // exactly 1024 bytes per frame, as Gnani requires
    }
    pos -= chunk.length;
  };
  const toPieces = (why: string) => { if (mode === "pieces") return; mode = "pieces"; seg = []; segMs = 0; silentMs = 0; voicedMs = 0; o.onMode?.("pieces", undefined, why); };

  function openLive(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false; const done = () => { if (!settled) { settled = true; resolve(); } };
      try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stt/stream`); ws.binaryType = "arraybuffer"; }
      catch { o.onMode?.("pieces", undefined, "live captions aren't available in this browser"); done(); return; }
      const t = setTimeout(() => { if (mode !== "live") { try { ws?.close(); } catch {} o.onMode?.("pieces", undefined, "the live connection didn't open in time"); done(); } }, 9000);
      ws.onopen = () => ws!.send(JSON.stringify({ type: "start", language: o.language, note_id: o.noteId, terms: o.terms || [] }));
      ws.onmessage = (ev) => {
        let m: any; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "ready") { clearTimeout(t); mode = "live"; o.onMode?.("live", m); done(); }
        else if (m.type === "transcript") o.onLive?.(m.text, m.language || "");
        else if (m.type === "warning") o.onWarn?.(`Gnani: ${m.message}`);
        else if (m.type === "error") { clearTimeout(t); o.onWarn?.(m.message); toPieces("the live connection failed"); done(); }
      };
      ws.onclose = () => { clearTimeout(t); if (!stopping) toPieces("the live connection closed"); done(); };
      ws.onerror = () => { clearTimeout(t); if (mode !== "live") { o.onMode?.("pieces", undefined, "the live connection couldn't be opened"); done(); } };
    });
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the microphone here (it needs https or localhost).");
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch { throw new Error("Microphone permission was denied. Allow it in the address bar, then try again."); }
    const AC = window.AudioContext || (window as any).webkitAudioContext; ctx = new AC(); sr = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } catch { await stop(); throw new Error("This browser can't record audio here. Use a recent Chrome, Edge or Safari."); } finally { URL.revokeObjectURL(url); }
    await ctx.resume();
    await openLive();
    const src = ctx.createMediaStreamSource(stream); node = new AudioWorkletNode(ctx, "cap"); const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    ctx.onstatechange = () => { if (ctx?.state === "suspended" && !paused) void ctx.resume(); };
    stream.getAudioTracks().forEach((t) => { t.onended = () => { emit(); o.onLost?.("The microphone stopped (unplugged, or another app took it)."); }; });
    document.addEventListener("visibilitychange", onVis); void lockScreen();
    watch = setInterval(() => { if (!paused && Date.now() - lastAudio > 8000) { void ctx?.resume(); if (Date.now() - lastAudio > 20000) o.onWarn?.("No audio has arrived for 20 seconds. Is the microphone still connected?"); } }, 5000);
    node.port.onmessage = (ev) => {
      lastAudio = Date.now(); if (paused) return;
      const chunk: Float32Array = ev.data, ms = (chunk.length / sr) * 1000; let sum = 0; for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length), thr = Math.max(0.01, noise * 2.5 + 0.005); o.onLevel?.(rms);
      if (mode === "live") { pushLive(chunk); return; }
      if (rms < thr) { noise = noise * 0.98 + rms * 0.02; silentMs += ms; } else { silentMs = 0; voicedMs += ms; }
      seg.push(chunk); segMs += ms;
      if ((segMs > 20000 && silentMs > 350) || segMs > 28000) emit();        // cut at a pause; never above Gnani's 30 s REST limit
    };
  }
  function pause() { if (paused) return; paused = true; if (mode === "live") { try { ws?.send(JSON.stringify({ type: "pause" })); } catch {} } else emit(); }
  function resume() { paused = false; }
  async function stop() {
    stopping = true; clearInterval(watch); document.removeEventListener("visibilitychange", onVis); try { await wake?.release(); } catch {} wake = null;
    if (mode === "live" && ws?.readyState === 1) {                         // let the last sentence finish, then close
      ws.send(JSON.stringify({ type: "stop" }));
      await new Promise<void>((r) => { const t = setTimeout(r, 6000); ws!.addEventListener("close", () => { clearTimeout(t); r(); }); ws!.addEventListener("message", (ev) => { try { if (JSON.parse(ev.data).type === "closed") { clearTimeout(t); setTimeout(r, 200); } } catch {} }); });
    } else emit();
    try { ws?.close(); } catch {} ws = null;
    try { node?.port.close(); node?.disconnect(); } catch {} stream?.getTracks().forEach((t) => t.stop()); await ctx?.close().catch(() => {});
    stream = null; ctx = null; node = null;
  }
  return { start, pause, resume, stop, get paused() { return paused; }, get mode() { return mode; } };
}

/** Record a short clip (for the accuracy test). */
export async function recordClip(seconds: number, onTick?: (left: number) => void): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const AC = window.AudioContext || (window as any).webkitAudioContext, ctx = new AC(), url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, "cap"), mute = ctx.createGain(); mute.gain.value = 0; src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  const parts: Float32Array[] = []; node.port.onmessage = (ev) => parts.push(ev.data);
  for (let s = seconds; s > 0; s--) { onTick?.(s); await new Promise((r) => setTimeout(r, 1000)); }
  node.disconnect(); stream.getTracks().forEach((t) => t.stop()); const sr = ctx.sampleRate; await ctx.close();
  let len = 0; for (const c of parts) len += c.length; const pcm = new Float32Array(len); let p = 0; for (const c of parts) { pcm.set(c, p); p += c.length; }
  return encodeWav16k(pcm, sr);
}
