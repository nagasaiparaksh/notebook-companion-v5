/**
 * Hands-free voice loop. Keeps the microphone open, detects when the person starts and stops talking (voice-activity detection),
 * and hands each finished utterance over as a 16 kHz mono WAV (what Gnani STT wants - no ffmpeg, no MediaRecorder clipping the first syllable,
 * because a short pre-roll of audio is kept and prepended).
 */
export type VoiceState = "off" | "starting" | "listening" | "hearing";

export function encodeWav16k(pcm: Float32Array, inRate: number): Blob {
  const ratio = inRate / 16000, n = Math.max(1, Math.floor(pcm.length / ratio)), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { // box-filter downsample
    const a = Math.floor(i * ratio), b = Math.min(pcm.length, Math.max(a + 1, Math.floor((i + 1) * ratio))); let sum = 0;
    for (let j = a; j < b; j++) sum += pcm[j];
    out[i] = Math.max(-1, Math.min(1, sum / (b - a))) * 0x7fff;
  }
  const dv = new DataView(new ArrayBuffer(44 + n * 2)); const W = (o: number, t: string) => [...t].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  W(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); W(8, "WAVE"); W(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); W(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, out[i], true);
  return new Blob([dv], { type: "audio/wav" });
}

export const WORKLET = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}
process(i){const c=i[0]&&i[0][0];if(c){this.b.push(c.slice(0));this.n+=c.length;if(this.n>=2048){const o=new Float32Array(this.n);let p=0;for(const x of this.b){o.set(x,p);p+=x.length}this.port.postMessage(o,[o.buffer]);this.b=[];this.n=0}}return true}}
registerProcessor('cap',Cap)`;

export type LoopOpts = {
  onState: (s: VoiceState) => void;
  onUtterance: (wav: Blob, seconds: number) => Promise<void>;
  onError: (message: string) => void;
  onLevel?: (rms: number) => void;
  /** return true while the app is speaking (or otherwise must not listen) so its own voice is never transcribed */
  isBlocked: () => boolean;
};

export function createVoiceLoop(o: LoopOpts) {
  let stream: MediaStream | null = null, ctx: AudioContext | null = null, node: AudioWorkletNode | null = null, alive = false;
  let state: VoiceState = "off";
  const set = (s: VoiceState) => { if (s !== state) { state = s; o.onState(s); } };
  let queue: Promise<void> = Promise.resolve();

  async function start() {
    if (alive) return; alive = true; set("starting");
    if (!navigator.mediaDevices?.getUserMedia) { alive = false; set("off"); throw new Error("This browser can't use the microphone here (it needs https or localhost)."); }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch { alive = false; set("off"); throw new Error("Microphone permission was denied. Allow it in the address bar, then tap the mic again."); }
    const AC = window.AudioContext || (window as any).webkitAudioContext; ctx = new AC();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } catch { stop(); throw new Error("This browser can't capture audio for voice mode. Use a recent Chrome, Edge or Safari."); } finally { URL.revokeObjectURL(url); }
    if (!alive) return;
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream); node = new AudioWorkletNode(ctx, "cap"); const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    const sr = ctx.sampleRate; let noise = 0.008, voiced = 0, silentMs = 0, segMs = 0, voicedMs = 0, inSpeech = false; let seg: Float32Array[] = []; const pre: Float32Array[] = [];
    node.port.onmessage = (ev) => {
      const chunk: Float32Array = ev.data, ms = (chunk.length / sr) * 1000; let sum = 0; for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length); o.onLevel?.(rms);
      if (o.isBlocked()) { inSpeech = false; seg = []; voiced = 0; silentMs = 0; pre.length = 0; set("listening"); return; }
      const thr = Math.min(0.08, Math.max(0.016, noise * 2.8 + 0.008));
      if (!inSpeech) {
        pre.push(chunk); if (pre.length > 9) pre.shift();               // ~400 ms pre-roll so the first syllable is never lost
        if (rms < thr) noise = noise * 0.97 + rms * 0.03;               // learn the room's background level
        voiced = rms > thr ? voiced + 1 : 0;
        if (voiced >= 2) { inSpeech = true; seg = [...pre]; pre.length = 0; silentMs = 0; segMs = 0; voicedMs = 0; set("hearing"); }
        else set("listening");
        return;
      }
      seg.push(chunk); segMs += ms;
      if (rms > thr * 0.7) { silentMs = 0; if (rms > thr) voicedMs += ms; } else silentMs += ms;
      if (silentMs > 1100 || segMs > 50000) {
        const all = seg, enough = voicedMs >= 320; inSpeech = false; seg = []; voiced = 0; silentMs = 0; set("listening");
        if (!enough) return;                                            // a click or cough, not speech
        let len = 0; for (const c of all) len += c.length; const pcm = new Float32Array(len); let p = 0; for (const c of all) { pcm.set(c, p); p += c.length; }
        const wav = encodeWav16k(pcm, sr), secs = len / sr;
        queue = queue.then(() => alive ? o.onUtterance(wav, secs) : undefined).catch((e) => o.onError(e?.message || "Voice processing failed."));
      }
    };
    set("listening");
  }
  function stop() {
    alive = false; try { node?.port.close(); node?.disconnect(); } catch {} stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {});
    stream = null; ctx = null; node = null; set("off");
  }
  return { start, stop, get state() { return state; } };
}
