export async function api<T = any>(path: string, opts: RequestInit & { json?: any } = {}): Promise<T> {
  const init: RequestInit = { ...opts };
  if (opts.json !== undefined) { init.method = init.method || "POST"; init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(opts.json); }
  let r: Response;
  try { r = await fetch("/api" + path, init); } catch (e: any) { throw new Error(e?.name === "AbortError" ? "This is taking too long. Please try again." : "Can't reach the backend. Is Flask running on port 5000?"); }
  if (r.status === 204) return null as T;
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    const j = ct.includes("json") ? await r.json().catch(() => ({})) : {};
    if (r.status === 401 && j.access) window.dispatchEvent(new Event("nc-access-needed"));     // App shows the access-code screen
    if (r.status === 401 && j.auth) window.dispatchEvent(new Event("nc-login-needed"));        // the login ran out: App asks to log in again
    throw new Error(j.error || `Request failed (${r.status})`);
  }
  return (ct.includes("json") ? r.json() : r.blob()) as any;
}
export const stripHtml = (h: string) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** Text -> speakable text (no note tags, markdown or HTML). */
export const speakable = (t: string) => stripHtml(t).replace(/\[note:\d+\]/g, "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();

/** Gnani speeds the voice itself between 0.85x and 1.15x; anything beyond that is added when playing. */
const nativeSpeed = () => Math.min(1.15, Math.max(0.85, ttsPrefs().speed));
const extraRate = () => ttsPrefs().speed / nativeSpeed();
export const ttsPrefs = () => { let sp = 1.15, model = ""; try { sp = Math.min(2, Math.max(.5, Number(localStorage.getItem("ttsSpeed")) || 1.15)); model = localStorage.getItem("ttsModel") || ""; } catch {} return { speed: sp, model }; };
let token = 0;
const live = new Set<AudioBufferSourceNode>(), readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
let actx: AudioContext | null = null;
const audioCtx = () => { if (!actx || actx.state === "closed") { const AC = window.AudioContext || (window as any).webkitAudioContext; actx = new AC(); } return actx; };
export function stopSpeaking() {
  token++; live.forEach((s) => { try { s.stop(); } catch {} }); live.clear(); readers.forEach((r) => r.cancel().catch(() => {})); readers.clear();
  try { window.speechSynthesis?.cancel(); } catch {} aborts.forEach((a) => a.abort()); aborts.clear();
}

/** UI hooks: onPlay fires when sound really starts (not when we only asked for it); onFallback when Gnani fails and the browser's own voice takes over. */
export const speechHooks: { lang?: string; onPlay?: () => void; onFallback?: (why: string) => void } = {};
const aborts = new Set<AbortController>();
let gnaniDownUntil = 0;                      // after Gnani fails, use the browser voice for a while instead of making every answer wait
const TTS_WAIT = 45000;
/** Cut text into pieces of at most `max` characters, at commas / semicolons / spaces. The server reads at most 600 characters per
 *  request, and Chrome's built-in voice silently stops on long utterances, so long run-on text (bullets, selections) must be split. */
export function splitLong(s: string, max = 280): string[] {
  const out: string[] = []; let rest = s.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf("; ", max), rest.lastIndexOf(": ", max), rest.lastIndexOf(" - ", max));
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max); if (cut < 20) cut = max;
    out.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest); return out;
}
/** The browser's built-in voice (Web Speech API): no network, used when Gnani's voice service doesn't answer or its audio can't be played. */
async function browserSay(text: string, my: number) {
  const ss = window.speechSynthesis; if (!ss || typeof SpeechSynthesisUtterance === "undefined") throw new Error("The voice service isn't answering, and this browser has no built-in voice. Try Chrome or Edge.");
  for (const piece of splitLong(text, 200)) {
    if (my !== token) return;
    await new Promise<void>((res, rej) => {
      const u = new SpeechSynthesisUtterance(piece), lang = speechHooks.lang || "en-IN"; u.lang = lang; u.rate = Math.min(1.6, Math.max(.6, ttsPrefs().speed));
      const v = ss.getVoices().find((x) => x.lang === lang) || ss.getVoices().find((x) => x.lang.startsWith(lang.split("-")[0])); if (v) u.voice = v;
      // Chrome sometimes never fires 'end': keep it awake and never wait longer than the text could possibly take
      const keep = setInterval(() => { if (my !== token) fin(); else if (ss.speaking && !ss.paused) { ss.pause(); ss.resume(); } }, 9000), guard = setTimeout(() => fin(), piece.length * 120 / u.rate + 6000);
      const fin = () => { clearInterval(keep); clearTimeout(guard); res(); };
      u.onstart = () => speechHooks.onPlay?.(); u.onend = fin;
      u.onerror = (e) => { clearInterval(keep); clearTimeout(guard); e.error === "interrupted" || e.error === "canceled" ? res() : rej(new Error(e.error === "not-allowed" ? "The browser blocked the voice. Click anywhere on the page, then try again." : "The browser's voice failed: " + e.error)); };
      setTimeout(() => (my === token ? ss.speak(u) : fin()), 60);      // speaking right after cancel() is sometimes ignored
    });
  }
}

/**
 * Read-aloud pipeline on Gnani Timbre. Feed it text as it arrives with push(); each finished sentence is sent to Gnani's
 * streaming TTS and its audio is scheduled on one AudioContext the moment the first chunk arrives (~1 s), back to back, so
 * there are no gaps and the next sentence is fetched while this one plays. Falls back to Gnani REST, then the browser's voice.
 * done resolves when everything has been spoken; it rejects with a readable error.
 */
export function startSpeaker(voice?: string, language = "auto") {
  stopSpeaking(); const my = token;
  let buf = "", first = true, ended = false, wake: (() => void) | null = null, browser = Date.now() < gnaniDownUntil, at = 0, started = false;
  const jobs: string[] = [];
  const poke = () => { wake?.(); wake = null; };
  const body = (text: string) => JSON.stringify({ text, voice, model: ttsPrefs().model || undefined, speed: nativeSpeed(), language });
  const ready = async () => {
    const ac = audioCtx(); if (ac.state !== "running") { try { await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch {} }
    if (ac.state !== "running") throw new Error("The browser blocked audio playback. Click anywhere on the page, then try again.");
    return ac;
  };
  const schedule = (ac: AudioContext, pcm: Float32Array, rate: number) => {
    const b = ac.createBuffer(1, pcm.length, rate); b.copyToChannel(new Float32Array(pcm), 0);
    const src = ac.createBufferSource(); src.buffer = b; src.playbackRate.value = extraRate(); src.connect(ac.destination);
    const t = Math.max(at, ac.currentTime + 0.04); src.start(t); at = t + b.duration / extraRate(); live.add(src); src.onended = () => live.delete(src);
    if (!started) { started = true; setTimeout(() => { if (my === token) speechHooks.onPlay?.(); }, Math.max(0, (t - ac.currentTime) * 1000)); }
  };
  /** Gnani SSE via our server: raw 16-bit PCM, scheduled in ~0.12 s blocks as it arrives. Returns false if the stream couldn't start. */
  const streamOne = async (text: string) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TTS_WAIT); aborts.add(ctl); let got = 0;
    try {
      const r = await fetch("/api/tts/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(text), signal: ctl.signal });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); if (r.status === 404) return false; throw new Error(j.error || `Voice request failed (${r.status})`); }
      const rate = Number(r.headers.get("X-Sample-Rate")) || 24000, ac = await ready(), reader = r.body.getReader(); readers.add(reader); clearTimeout(t);
      let carry = new Uint8Array(0), pend: Int16Array[] = [], n = 0;
      const flushPend = () => { if (!n) return; const f = new Float32Array(n); let o = 0; for (const p of pend) { for (let i = 0; i < p.length; i++) f[o++] = p[i] / 32768; } pend = []; n = 0; schedule(ac, f, rate); };
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (my !== token) return true; if (done) break;
          const all = carry.length ? (() => { const x = new Uint8Array(carry.length + value.length); x.set(carry); x.set(value, carry.length); return x; })() : value;
          const even = all.length - (all.length % 2); carry = all.slice(even); if (!even) continue;
          const s = new Int16Array(all.slice(0, even).buffer); pend.push(s); n += s.length; got += s.length;
          if (n >= rate * 0.12) flushPend();
        }
        flushPend();
      } finally { readers.delete(reader); }
      if (!got) throw new Error("Gnani sent no audio.");
      return true;
    } finally { clearTimeout(t); aborts.delete(ctl); }
  };
  /** Gnani REST (one WAV per sentence), decoded and scheduled on the same timeline. */
  const restOne = async (text: string) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TTS_WAIT); aborts.add(ctl);
    try { const blob = await api<Blob>("/tts", { json: JSON.parse(body(text)), signal: ctl.signal }); const ac = await ready(); const b = await ac.decodeAudioData(await blob.arrayBuffer()); schedule(ac, b.getChannelData(0), b.sampleRate); }
    finally { clearTimeout(t); aborts.delete(ctl); }
  };
  const waitTill = async (t: number) => { while (my === token && actx && actx.currentTime < t - 0.03) await new Promise((r) => setTimeout(r, Math.min(250, Math.max(20, (t - actx!.currentTime) * 1000 - 20)))); };
  const enqueue = (t: string) => { const clean = speakable(t); if (!clean) return; for (const piece of splitLong(clean)) jobs.push(piece); poke(); };
  const fallBack = (why: string) => { if (browser) return; browser = true; gnaniDownUntil = Date.now() + 120000; aborts.forEach((a) => a.abort()); speechHooks.onFallback?.(why); };
  const flush = (final: boolean) => {
    const parts = buf.split(/(?<=[.!?।\n])\s+/); const rest = final ? "" : parts.pop() || ""; let cur = "";
    for (const s of parts) { if ((cur + " " + s).length > 280 && cur) { enqueue(cur); cur = ""; first = false; } cur += (cur ? " " : "") + s; if (first && cur.length >= 25) { enqueue(cur); cur = ""; first = false; } }
    if (cur) { if (final || cur.length >= 80) enqueue(cur); else { buf = cur + (rest ? " " + rest : ""); return; } }
    buf = rest;
  };
  const done = (async () => {
    let i = 0, useStream = true;
    while (true) {
      if (my !== token) return;
      if (i >= jobs.length) { if (ended) { await waitTill(at); return; } await new Promise<void>((r) => (wake = r)); continue; }
      const text = jobs[i++];
      if (!browser) {
        try {
          if (useStream) { const ok = await streamOne(text); if (!ok) { useStream = false; await restOne(text); } }   // 404 = an older server without streaming
          else await restOne(text);
          continue;
        } catch (e: any) {
          if (my !== token) return;
          if (/blocked audio/.test(e?.message || "")) throw e;
          fallBack(e?.name === "AbortError" || /taking too long|in time/i.test(e?.message || "") ? "Gnani's voice service didn't answer in time" : e?.message || "Gnani voice failed");
        }
      }
      await waitTill(at); if (my !== token) return; await browserSay(text, my);                  // the browser's own voice, after any audio already queued
    }
  })();
  return { push: (d: string) => { buf += d; flush(false); }, end: () => { flush(true); ended = true; poke(); }, done, stop: stopSpeaking };
}
/** Speak a finished text (read-aloud). Throws on TTS/playback errors. */
export async function speak(text: string, voice?: string, onEnd?: () => void, language = "auto") {
  const sp = startSpeaker(voice, language); sp.push(text + " "); sp.end(); const my = token;
  try { await sp.done; } finally { if (my === token) onEnd?.(); }
}

/** Streams a Companion answer. onDelta gets text as it is generated; resolves with the final saved message. */
export async function askStream(sid: number, text: string, noteId: number | null, onDelta: (d: string) => void, extra: Record<string, any> = {}) {
  let r: Response;
  try { r = await fetch(`/api/chat/sessions/${sid}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, note_id: noteId, ...extra }) }); }
  catch { throw new Error("Can't reach the backend. Is Flask running on port 5000?"); }
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Request failed (${r.status})`); }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", final: any = null;
  while (true) {
    const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2); if (!line.startsWith("data:")) continue;
      const o = JSON.parse(line.slice(5)); if (o.error) throw new Error(o.error); if (o.delta) onDelta(o.delta); if (o.done) final = o;
    }
  }
  if (!final) throw new Error("The answer was cut off. Please try again.");
  return final as { content: string; sources: any[] };
}
