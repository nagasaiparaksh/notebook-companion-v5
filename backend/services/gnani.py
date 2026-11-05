import threading, json
import requests, subprocess, tempfile, os, glob, time, wave
import config
class GnaniError(Exception): pass
_S = requests.Session()
def _key():
    if not config.GNANI_API_KEY: raise GnaniError("GNANI_API_KEY is not set in backend/.env.")
    return {"X-API-Key-ID": config.GNANI_API_KEY}
def _wav_segments(path, seconds=28):
    """Split a PCM WAV with the stdlib (no ffmpeg needed). Returns None if the file isn't plain PCM WAV."""
    try:
        with wave.open(path, "rb") as w:
            ch, sw, fr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            if n / float(fr or 1) < 0.3: raise GnaniError("The recording is too short - no speech detected.")
            out, per, i = tempfile.mkdtemp(), int(fr * seconds), 0; segs = []
            while True:
                frames = w.readframes(per)
                if not frames: break
                sp = os.path.join(out, f"s{i:04d}.wav"); i += 1
                with wave.open(sp, "wb") as o: o.setnchannels(ch); o.setsampwidth(sw); o.setframerate(fr); o.writeframes(frames)
                segs.append(sp)
            return segs
    except (wave.Error, EOFError): return None
def _segments(path, seconds=28):
    """REST STT accepts at most 30 s per request. WAV is split in pure Python; other formats use ffmpeg -> 16k mono WAV."""
    segs = _wav_segments(path, seconds)
    if segs is not None: return segs
    out = tempfile.mkdtemp()
    try:
        subprocess.run(["ffmpeg", "-y", "-i", path, "-ac", "1", "-ar", "16000", "-f", "segment",
                        "-segment_time", str(seconds), os.path.join(out, "s%04d.wav")],
                       check=True, capture_output=True)
    except FileNotFoundError: raise GnaniError("This audio format needs ffmpeg on the server. Install ffmpeg, or record from the app (it sends WAV, which needs no ffmpeg).")
    except subprocess.CalledProcessError as e: raise GnaniError("Could not decode audio: " + e.stderr.decode()[-200:])
    return sorted(glob.glob(os.path.join(out, "s*.wav")))
STT_MODEL = "prisma-v3.0"
INDIC = {"bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN"}

def clean_language(code):
    """'te-IN,en-IN' / 'indic-auto' / 'hi-IN' -> a value Prisma v3 accepts (1-4 known codes, or indic-auto)."""
    if (code or "").strip() in ("indic-auto", "auto"): return "indic-auto"
    codes = [c.strip() for c in (code or "").split(",") if c.strip() in INDIC][:4]
    return ",".join(dict.fromkeys(codes)) or "en-IN"

def stt_format(code):
    """Mixed-language speech keeps English technical words in Latin script ('codemix'); one language gets digits for numbers."""
    return "codemix" if ("," in code or code == "indic-auto") else "transcribe" if code in ("en-IN", "hi-IN") else "verbatim"

def context_fields(ctx):
    """Prisma v3 context: up to 200 keyterms, a topic (<=1600 chars) and the previous clip's text (last 600 chars)."""
    if not ctx: return {}
    out = {}
    terms = [str(t).strip().replace("<|", "").replace("|>", "")[:60] for t in (ctx.get("keyterms") or []) if str(t).strip()]
    if terms: out["keyterms"] = json.dumps(list(dict.fromkeys(terms))[:200], ensure_ascii=False)
    if (ctx.get("topic") or "").strip(): out["topic"] = ctx["topic"].replace("<|", "").replace("|>", "").strip()[:1600]
    if (ctx.get("previous_text") or "").strip(): out["previous_text"] = ctx["previous_text"].replace("<|", "").replace("|>", "").strip()[-600:]
    return out

def _stt_once(seg, data, headers):
    with open(seg, "rb") as f: r = _S.post(config.GNANI_STT_URL, headers=headers, timeout=(10, 120), files={"audio_file": f}, data=data)
    if r.status_code in (401, 403): raise GnaniError("Gnani rejected the API key.")
    if r.status_code == 402: raise GnaniError("The Gnani account has run out of credit.")
    return r

def transcribe_full(path, language_code, ctx=None):
    """Prisma v3.0 speech-to-text, syllabus-aware: course terms / topic / previous text are sent as context.
    Returns {"text", "language", "context_used"}; falls back to no context (and then to v2.5) if Gnani rejects them."""
    headers = _key(); code = clean_language(language_code); parts, langs = [], []
    base = {"model": STT_MODEL, "language_code": code, "format": stt_format(code)}
    extra = context_fields(ctx); used = bool(extra); prev = (ctx or {}).get("previous_text") or ""
    for seg in _segments(path):
        data = {**base, **extra}
        if prev: data["previous_text"] = prev[-600:]
        r = _stt_once(seg, data, headers)
        if r.status_code == 400 and extra and "CONTEXT" in r.text.upper(): extra = {}; used = False; r = _stt_once(seg, base, headers)       # context rejected: plain v3
        if r.status_code == 400 and ("MODEL" in r.text.upper()):                                                                            # v3 not enabled on this key: v2.5
            r = _stt_once(seg, {"language_code": code.split(",")[0] if code != "indic-auto" else "en-IN", "format": "transcribe"}, headers); used = False
        if r.status_code == 429: time.sleep(1.5); r = _stt_once(seg, {**base, **extra}, headers)
        if r.status_code != 200: raise GnaniError(f"Gnani STT error {r.status_code}: {r.text[:200]}")
        j = r.json(); t = (j.get("transcript") or j.get("text") or "").strip()
        if t: parts.append(t); prev = (prev + " " + t)[-600:]
        if j.get("detected_language_code"): langs.append(j["detected_language_code"])
    return {"text": " ".join(parts), "language": max(set(langs), key=langs.count) if langs else "", "context_used": used}

def transcribe(path, language_code):
    return transcribe_full(path, language_code)["text"]
_TTS_LOCK = threading.Lock()  # Gnani allows ONE active TTS request per account; everything here goes through this lock
def synthesize(text, voice, model=None, language="auto", speed=1.0):
    payload = {"text": text, "voice": voice, "model": model or config.GNANI_TTS_MODEL, "language": language, "speed": round(speed, 2),
               "audio_config": {"container": "wav", "encoding": "linear_pcm", "sample_rate": 24000, "num_channels": 1, "sample_width": 2}}
    last, headers = None, {**_key(), "Content-Type": "application/json"}
    # A hung Gnani request must never block every later one: wait for the lock at most 40 s, and give up on the whole call after ~60 s
    # (the browser then falls back to its own voice instead of showing "Speaking" in silence).
    if not _TTS_LOCK.acquire(timeout=40): raise GnaniError("Gnani voice is still busy with an earlier request. Please try again in a moment.")
    try:
        start = time.time()
        for attempt in range(6):
            left = 60 - (time.time() - start)
            if left < 5: break
            try:
                r = _S.post(config.GNANI_TTS_URL, headers=headers, timeout=(8, min(40, left)), json=payload)
                if r.status_code in (429, 500, 502, 503, 504) and attempt < 5:
                    # 429 usually means a request we already sent (e.g. one the browser abandoned) is still finishing on Gnani's side
                    last = f"HTTP {r.status_code}"; time.sleep(0.8 + attempt * 0.9); continue
                if r.status_code == 429:
                    raise GnaniError("Gnani voice is busy finishing another request. Please try again in a few seconds.")
                if r.status_code != 200:
                    raise GnaniError(f"Gnani TTS error {r.status_code}: {r.text[:300]}")
                if not r.content:
                    raise GnaniError("Gnani TTS returned an empty audio response.")
                return r.content
            except requests.Timeout as e:
                raise GnaniError("Gnani's voice service didn't answer in time.") from e   # one slow answer means the service is struggling: don't queue more waits
            except requests.ConnectionError as e:
                if "timed out" in str(e).lower(): raise GnaniError("Gnani's voice service didn't answer in time.") from e   # requests reports some read timeouts this way
                last = e; time.sleep(1 + attempt)
        raise GnaniError(f"Gnani's voice service isn't answering right now ({last or 'timed out'}).")
    finally: _TTS_LOCK.release()


TTS_SSE_URL = "https://api.vachana.ai/api/v1/tts/sse"
def synthesize_stream(text, voice, model=None, language="auto", speed=1.0, rate=24000):
    """Gnani Timbre over SSE: yields raw 16-bit mono PCM chunks as they are synthesised, so playback starts after the first
    chunk (~1 s) instead of after the whole sentence (~3 s). Raises GnaniError before yielding if Gnani refuses."""
    payload = {"text": text, "voice": voice, "model": model or config.GNANI_TTS_MODEL, "language": language, "speed": round(speed, 2),
               "audio_config": {"sample_rate": rate, "encoding": "linear_pcm", "container": "raw", "num_channels": 1, "sample_width": 2}}
    if not _TTS_LOCK.acquire(timeout=40): raise GnaniError("Gnani voice is still busy with an earlier request. Please try again in a moment.")
    try:
        for attempt in range(3):
            try: r = _S.post(TTS_SSE_URL, headers={**_key(), "Content-Type": "application/json"}, json=payload, stream=True, timeout=(8, 30))
            except requests.RequestException as e: raise GnaniError("Gnani's voice service didn't answer in time.") from e
            if r.status_code in (429, 500, 502, 503) and attempt < 2: r.close(); time.sleep(0.8 + attempt); continue
            break
        if r.status_code != 200: msg = r.text[:200]; r.close(); raise GnaniError(f"Gnani TTS error {r.status_code}: {msg}")
    except BaseException: _TTS_LOCK.release(); raise
    def gen():
        import base64
        try:
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"): continue
                try: d = json.loads(line[5:].strip())
                except ValueError: continue
                if d.get("type") == "error": break
                if d.get("audio"): yield base64.b64decode(d["audio"])
                if d.get("is_final"): break
        except requests.RequestException: pass
        finally: r.close(); _TTS_LOCK.release()
    return gen()

def _fix_wav(b):
    """Gnani streams WAV with placeholder sizes (0xFFFFFFFF = "unknown length"), so the header claims ~25 hours of audio.
    Browsers then never fire 'ended' (read-aloud hangs on "Speaking" and the next sentence never plays) or refuse to play it.
    Rewrite the RIFF and data sizes to the real byte counts."""
    import struct
    b = bytearray(b); i = 12
    while i + 8 <= len(b):
        cid, size = bytes(b[i:i + 4]), struct.unpack("<I", b[i + 4:i + 8])[0]
        if cid == b"data":
            real = len(b) - (i + 8)
            if real % 2: real -= 1; del b[-1]                   # keep whole 16-bit samples
            b[i + 4:i + 8] = struct.pack("<I", real); break
        if size > len(b) - (i + 8): break                       # malformed chunk before 'data': leave as is
        i += 8 + size + (size & 1)
    b[4:8] = struct.pack("<I", len(b) - 8)
    return bytes(b)

def as_playable(b):
    """Gnani may return WAV, MP3, OGG, JSON-wrapped base64 or headerless PCM. Work out which, so the browser always gets playable audio."""
    import base64, json, struct
    if b[:1] in (b"{", b"["):
        try:
            j = json.loads(b.decode("utf-8", "ignore")); v = j if isinstance(j, str) else next((j[k] for k in ("audio", "audio_content", "data", "audioContent") if isinstance(j, dict) and isinstance(j.get(k), str)), None)
            if v: b = base64.b64decode(v.split(",")[-1])
        except Exception: pass
    if b[:4] == b"RIFF": return _fix_wav(b), "audio/wav"
    if b[:3] == b"ID3" or (len(b) > 1 and b[0] == 0xFF and b[1] & 0xE0 == 0xE0): return b, "audio/mpeg"
    if b[:4] == b"OggS": return b, "audio/ogg"
    if b[:4] == b"fLaC": return b, "audio/flac"
    if b[4:8] == b"ftyp": return b, "audio/mp4"
    rate = 24000                                            # headerless 16-bit mono PCM: wrap it in a WAV header
    hdr = b"RIFF" + struct.pack("<I", 36 + len(b)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(b))
    return hdr + b, "audio/wav"
