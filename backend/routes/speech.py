"""Everything that listens, built on Gnani Prisma v3.0:
- syllabus-aware transcription (course keyterms + topic + previous text as context, code-mixed output)
- a with/without-context accuracy test, so the benefit can be measured
- recorded-lecture upload through Gnani Batch, with speaker labels (teacher vs students)
- live lecture captions: a WebSocket relay to Gnani's realtime stream (the API key never reaches the browser)
- translation for reading notes aloud in the student's own language (Gnani Timbre speaks it)
- the Impact page's numbers"""
import io, json, os, re, tempfile, threading, time, wave
import requests
from flask import Blueprint, request, jsonify, g
import config
from db import get_db, standalone
from services import gnani, llm, speech_context, stats
bp = Blueprint("speech", __name__)
BATCH = "https://api.vachana.ai/stt/v3/batch/jobs"
STREAM = "wss://api.vachana.ai/stt/v3/stream"
LANG_NAMES = {"bn-IN": "Bengali", "en-IN": "English", "gu-IN": "Gujarati", "hi-IN": "Hindi", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu"}

def _terms(raw):
    try: v = json.loads(raw) if isinstance(raw, str) else raw
    except Exception: v = []
    return [str(t) for t in (v or [])][:80] if isinstance(v, list) else []

def _wav_seconds(path):
    try:
        with wave.open(path, "rb") as w: return w.getnframes() / float(w.getframerate() or 1)
    except Exception: return 0.0

# ----------------------------------------------------------------------- transcription (dictation + lecture pieces)
@bp.post("/audio/transcribe")
def transcribe():
    f = request.files.get("audio")
    if not f: return jsonify(error="No audio received"), 400
    code = gnani.clean_language(request.form.get("language", "en-IN")); use_ctx = request.form.get("context", "1") != "0"
    ctx = speech_context.build(get_db(), request.form.get("note_id"), _terms(request.form.get("terms")), request.form.get("previous_text", "")) if use_ctx else None
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(f.filename or "a.wav")[1] or ".wav") as t: f.save(t.name)
    try:
        r = gnani.transcribe_full(t.name, code, ctx); secs = _wav_seconds(t.name)
        stats.log("stt", source=request.form.get("source", "dictation"), seconds=round(secs, 1), words=len(r["text"].split()), language=r["language"] or code, context=r["context_used"], keyterms=len((ctx or {}).get("keyterms") or []))
        return jsonify(transcript=r["text"], language=r["language"], context_used=r["context_used"], keyterms=len((ctx or {}).get("keyterms") or []))
    finally: os.unlink(t.name)

# ----------------------------------------------------------------------- measurable benefit: the same clip with and without course context
@bp.post("/audio/compare")
def compare():
    f = request.files.get("audio")
    if not f: return jsonify(error="No audio received"), 400
    code = gnani.clean_language(request.form.get("language", "en-IN")); nid = request.form.get("note_id")
    ctx = speech_context.build(get_db(), nid, _terms(request.form.get("terms")))
    if not ctx["keyterms"]: return jsonify(error="There are no course terms yet. Add course material (📚) first, so there is something to compare."), 400
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as t: f.save(t.name)
    try:
        plain = gnani.transcribe_full(t.name, code, None); aware = gnani.transcribe_full(t.name, code, ctx)
    finally: os.unlink(t.name)
    def hits(text):
        low = " " + re.sub(r"[^\w]+", " ", text.lower()) + " "
        return [k for k in ctx["keyterms"] if len(k) > 1 and (" " + re.sub(r"[^\w]+", " ", k.lower()).strip() + " ") in low]
    hp, ha = hits(plain["text"]), hits(aware["text"])
    out = {"without": plain["text"], "with": aware["text"], "terms_without": hp, "terms_with": ha, "gained": [k for k in ha if k not in hp], "lost": [k for k in hp if k not in ha],
           "context_used": aware["context_used"], "keyterms": len(ctx["keyterms"]), "language": aware["language"] or plain["language"]}
    stats.log("compare", terms_with=len(ha), terms_without=len(hp), gained=len(out["gained"]), lost=len(out["lost"]), language=out["language"], keyterms=len(ctx["keyterms"]))
    return jsonify(out)

# ----------------------------------------------------------------------- recorded lecture -> Gnani Batch (long audio, any format, speaker labels)
@bp.post("/lecture/upload")
def lecture_upload():
    f = request.files.get("file")
    if not f: return jsonify(error="No recording received."), 400
    data = f.read()
    if len(data) > 10 * 1024 * 1024: return jsonify(error="Gnani accepts recordings up to 10 MB per file. Record at a lower quality (e.g. a voice-memo app), or split it into parts."), 400
    code = gnani.clean_language(request.form.get("language", "en-IN")); ctx = speech_context.build(get_db(), request.form.get("note_id"), _terms(request.form.get("terms")))
    cfg = {"model": gnani.STT_MODEL, "language_code": code, "mode": "transcribe", "with_diarization": True, "num_speakers": max(1, min(8, int(request.form.get("speakers") or 5))), "with_denoise": True}
    if "," in code or code == "indic-auto": cfg["format"] = "codemix"
    if ctx["keyterms"]: cfg["keyterms"] = json.dumps(ctx["keyterms"], ensure_ascii=False)
    if ctx["topic"]: cfg["topic"] = ctx["topic"]
    h = gnani._key()
    try:
        r = requests.post(BATCH, headers=h, files=[("config", (None, json.dumps(cfg), "application/json")), ("files", (f.filename or "lecture.m4a", data, f.mimetype or "application/octet-stream"))], timeout=(10, 180))
        if r.status_code == 400 and ("keyterms" in cfg or "topic" in cfg):                         # context rejected: try without it
            cfg.pop("keyterms", None); cfg.pop("topic", None)
            r = requests.post(BATCH, headers=h, files=[("config", (None, json.dumps(cfg), "application/json")), ("files", (f.filename or "lecture.m4a", data, f.mimetype or "application/octet-stream"))], timeout=(10, 180))
        if r.status_code not in (200, 201): return jsonify(error=f"Gnani couldn't accept the recording ({r.status_code}): {r.text[:200]}"), 502
        job = r.json()["job_id"]
        s = requests.post(f"{BATCH}/{job}/start", headers=h, timeout=(10, 60))
        if s.status_code not in (200, 201, 202): return jsonify(error=f"Gnani couldn't start transcribing ({s.status_code}): {s.text[:200]}"), 502
    except requests.RequestException as e: return jsonify(error="Couldn't reach Gnani: " + str(e)[:160]), 502
    stats.log("batch", bytes=len(data), language=code, keyterms=len(ctx["keyterms"]))
    return jsonify(job_id=job, keyterms=len(ctx["keyterms"]))

@bp.get("/lecture/upload/<job_id>")
def lecture_upload_status(job_id):
    if not re.fullmatch(r"[\w-]{8,80}", job_id): return jsonify(error="Bad job id."), 400
    h = gnani._key()
    try:
        j = requests.get(f"{BATCH}/{job_id}", headers=h, timeout=(10, 30)).json(); st = j.get("status", "")
        if st not in ("COMPLETED", "PARTIAL_FAILURE"):
            if st in ("FAILED", "START_FAILED", "CANCELLED"): return jsonify(status=st, error=f"Gnani couldn't transcribe the recording ({st.lower().replace('_', ' ')}{': ' + str(j.get('cancel_reason')) if j.get('cancel_reason') else ''}).")
            return jsonify(status=st or "PROCESSING", progress=j.get("progress"))
        files = requests.get(f"{BATCH}/{job_id}/files", headers=h, params={"status": "COMPLETED"}, timeout=(10, 30)).json().get("data") or []
        if not files: return jsonify(status="FAILED", error="Gnani finished but returned no transcript (was the recording silent?).")
        res = requests.get(files[0]["transcript_url"], timeout=(10, 60)).json()
    except (requests.RequestException, ValueError, KeyError) as e: return jsonify(error="Couldn't get the transcript from Gnani: " + str(e)[:160]), 502
    segs = res.get("segments") or []
    talk = {}
    for s in segs: talk[s.get("speaker_id")] = talk.get(s.get("speaker_id"), 0) + float(s.get("end_time", 0)) - float(s.get("start_time", 0))
    teacher = max(talk, key=talk.get) if talk else None; names = {}
    for sp in sorted(talk, key=lambda k: -talk[k]): names[sp] = "Teacher" if sp == teacher else f"Student {len(names)}"
    lines, cur, buf = [], None, []
    for s in segs:
        if s.get("speaker_id") != cur and buf: lines.append(f"{names.get(cur, 'Speaker')}: {' '.join(buf)}"); buf = []
        cur = s.get("speaker_id"); buf.append(str(s.get("text") or "").strip())
    if buf: lines.append(f"{names.get(cur, 'Speaker')}: {' '.join(buf)}")
    text = "\n".join(l for l in lines if l.split(":", 1)[1].strip()) if len(talk) > 1 else (res.get("full_transcript") or " ".join(s.get("text", "") for s in segs))
    stats.log("stt", source="recording", seconds=round(float(res.get("duration_seconds") or 0), 1), words=len(text.split()), language=res.get("language_code", ""), context=True, speakers=len(talk))
    return jsonify(status="COMPLETED", transcript=text, speakers=len(talk), duration=res.get("duration_seconds"), language=res.get("language_code"))

# ----------------------------------------------------------------------- read notes in the student's own language
@bp.post("/translate")
def translate():
    d = request.json or {}; text = str(d.get("text") or "").strip()[:4000]; to = d.get("to") or "hi-IN"
    if not text: return jsonify(error="Nothing to translate."), 400
    name = LANG_NAMES.get(to, "Hindi")
    try: out = llm.chat([{"role": "system", "content": f"Translate the student's notes into simple, natural spoken {name}, the way a friendly teacher would explain them aloud. Keep technical terms, names, formulas and acronyms in English (e.g. RNN, backpropagation). Return only the translation."},
                         {"role": "user", "content": text}], temperature=0.2, max_tokens=3000, timeout=(6, 60)).strip()
    except Exception as e: return jsonify(error="The AI couldn't translate right now: " + str(e)[:160]), 503
    stats.log("translate", to=to, chars=len(text))
    return jsonify(text=out, language=to, name=name)

# ----------------------------------------------------------------------- impact numbers
@bp.get("/stats/impact")
def impact():
    db = get_db(); u = g.uid; ev = [(r["kind"], json.loads(r["data"] or "{}"), r["created"]) for r in db.execute("SELECT kind,data,created FROM events WHERE user_id=?", (u,))]
    stt = [d for k, d, _ in ev if k in ("stt", "stt_stream")]; cmp_ = [d for k, d, _ in ev if k == "compare"]
    langs = {}
    for d in stt:
        for c in str(d.get("language") or "").split(","):
            if c: langs[LANG_NAMES.get(c, c)] = langs.get(LANG_NAMES.get(c, c), 0) + float(d.get("seconds") or 0)
    words_notes = 0
    for r in db.execute("SELECT content FROM notes WHERE user_id=?", (u,)): words_notes += len(re.sub(r"<[^>]+>", " ", r["content"] or "").split())
    cov = [json.loads(r["data"]).get("percent") for r in db.execute("SELECT c.data FROM coverage c JOIN notes n ON n.id=c.note_id WHERE n.user_id=?", (u,))]
    days = {time.strftime("%Y-%m-%d", time.localtime(t)) for _, _, t in ev}
    return jsonify({
        "notebooks": db.execute("SELECT count(*) FROM notes WHERE user_id=?", (u,)).fetchone()[0], "words_in_notes": words_notes,
        "materials": db.execute("SELECT count(*) FROM materials m JOIN notes n ON n.id=m.note_id WHERE n.user_id=?", (u,)).fetchone()[0],
        "speech_minutes": round(sum(float(d.get("seconds") or 0) for d in stt) / 60, 1), "speech_words": sum(int(d.get("words") or 0) for d in stt),
        "with_context_share": round(100 * sum(1 for d in stt if d.get("context")) / len(stt)) if stt else 0,
        "languages": {k: round(v / 60, 1) for k, v in sorted(langs.items(), key=lambda x: -x[1])},
        "lectures": sum(1 for k, _, _ in ev if k == "lecture_notes"), "recordings": sum(1 for k, _, _ in ev if k == "batch"), "live_minutes": round(sum(float(d.get("seconds") or 0) for k, d, _ in ev if k == "stt_stream") / 60, 1),
        "study_sets": sum(1 for k, _, _ in ev if k == "study"), "translations": sum(1 for k, _, _ in ev if k == "translate"),
        "coverage_avg": round(sum(cov) / len(cov)) if cov else None, "coverage_checks": sum(1 for k, _, _ in ev if k == "coverage"),
        "accuracy_tests": len(cmp_), "terms_with": sum(int(d.get("terms_with") or 0) for d in cmp_), "terms_without": sum(int(d.get("terms_without") or 0) for d in cmp_),
        "active_days": len(days), "since": min((t for _, _, t in ev), default=None),
        "feedback": [{"rating": d.get("rating"), "text": d.get("text"), "name": d.get("name"), "at": t} for k, d, t in sorted(ev, key=lambda x: -x[2]) if k == "feedback"][:30]})

@bp.post("/stats/feedback")
def feedback():
    d = request.json or {}; text = str(d.get("text") or "").strip()[:600]; rating = d.get("rating") if d.get("rating") in (1, 2, 3, 4, 5) else None
    if not text and rating is None: return jsonify(error="Write a few words or pick a rating."), 400
    stats.log("feedback", rating=rating, text=text, name=str(d.get("name") or "").strip()[:60])
    return jsonify(ok=True)

# ----------------------------------------------------------------------- live lecture captions: browser <-> this server <-> Gnani realtime
def closing(fn):
    """Always send a proper WebSocket close frame before the handler returns. Otherwise the server's trailing HTTP reply lands
    on the upgraded connection and the browser reports 'Invalid frame header' (and can lose the last caption)."""
    import functools
    @functools.wraps(fn)
    def w(ws):
        try: return fn(ws)
        finally:
            try: ws.close(reason=1000)
            except Exception: pass
            if getattr(ws, "mode", "") == "werkzeug":       # the dev server would still write "HTTP/1.1 200" onto the socket: end it first
                import socket
                try: time.sleep(0.2); ws.sock.shutdown(socket.SHUT_RDWR); ws.sock.close()
                except Exception: pass
    return w

def register_ws(sock):
    @sock.route("/api/stt/stream")
    @closing
    def stt_stream(ws):
        """Browser sends {"type":"start", language, note_id, terms} then 1024-byte 16 kHz PCM frames, and {"type":"pause"|"stop"}.
        Gnani sessions last 15 minutes, so the relay rolls over to a fresh session (carrying previous_text) without the browser noticing."""
        from websockets.sync.client import connect
        try: start = json.loads(ws.receive(timeout=15) or "{}")
        except Exception: return
        if not config.GNANI_API_KEY: ws.send(json.dumps({"type": "error", "message": "GNANI_API_KEY is not set in backend/.env."})); return
        code = gnani.clean_language(start.get("language")); db = standalone(); nid = start.get("note_id")
        try:
            from auth import owns_note
            if nid not in (None, "") and not owns_note(db, nid, g.get("uid")): nid = None     # only the signed-in account's own course terms
            ctx = speech_context.build(db, nid, _terms(start.get("terms")), start.get("previous_text") or "")
        finally: db.close()
        lock = threading.Lock(); st = {"up": None, "opened": 0.0, "prev": ctx["previous_text"], "alive": True, "segs": 0, "secs": 0.0, "fails": 0}
        def send(o):
            with lock:
                try: ws.send(json.dumps(o, ensure_ascii=False))
                except Exception: st["alive"] = False
        def headers():
            h = {"x-api-key-id": config.GNANI_API_KEY, "language_code": code, "model": gnani.STT_MODEL, "x-sample-rate": "16000", "format": gnani.stt_format(code), "x-idle-timeout-sec": "900"}
            if ctx["keyterms"]: h["keyterms"] = json.dumps(ctx["keyterms"])                   # ASCII-escaped JSON, as the docs require for headers
            if ctx["topic"]: h["topic"] = json.dumps(ctx["topic"])[1:-1]
            if st["prev"].strip(): h["previous_text"] = json.dumps(st["prev"][-600:])[1:-1]
            return h
        def reader(up):
            try:
                for raw in up:
                    m = json.loads(raw); t = m.get("type")
                    if t == "transcript" and str(m.get("text") or "").strip():
                        st["prev"] = (st["prev"] + " " + m["text"])[-600:]; st["segs"] += 1; st["words"] = st.get("words", 0) + len(m["text"].split()); st["secs"] += float(m.get("audio_duration_ms") or 0) / 1000
                        send({"type": "transcript", "text": m["text"].strip(), "language": m.get("detected_language_code", ""), "latency": m.get("latency")})
                    elif t == "connected": send({"type": "ready", "model": gnani.STT_MODEL, "language": code, "keyterms": len(ctx["keyterms"]), "topic": bool(ctx["topic"])})
                    elif t == "speech_start": send({"type": "speech"})
                    elif t == "error": send({"type": "warning", "message": str(m.get("message") or "")[:200]})
            except Exception: pass
            if st["alive"] and st["up"] is up:                                                    # Gnani closed the session (15-min limit, network): reconnect
                st["fails"] += 1
                if st["fails"] <= 3:
                    send({"type": "reconnecting"})
                    try: open_up(); return
                    except Exception as e: send({"type": "error", "message": "Lost the live connection to Gnani: " + str(e)[:120]})
                st["alive"] = False
        def open_up():
            up = connect(STREAM, additional_headers=headers(), open_timeout=12, max_size=2 ** 20)
            st["up"], st["opened"] = up, time.time(); threading.Thread(target=reader, args=(up,), daemon=True).start()
        def rotate():
            old = st["up"]; open_up(); st["fails"] = 0
            def finish():
                try: old.send(bytes(32000)); old.send(json.dumps({"type": "commit"})); time.sleep(4); old.close()
                except Exception: pass
            threading.Thread(target=finish, daemon=True).start()
        try: open_up()
        except Exception as e: send({"type": "error", "message": "Couldn't start Gnani live transcription: " + str(e)[:160]}); return
        try:
            while st["alive"]:
                msg = ws.receive(timeout=30)
                if msg is None: continue
                up = st["up"]
                if isinstance(msg, (bytes, bytearray)):
                    try: up.send(bytes(msg))
                    except Exception: pass
                    if time.time() - st["opened"] > 14 * 60: rotate()
                    continue
                c = json.loads(msg).get("type")
                if c in ("pause", "commit"):
                    try: up.send(json.dumps({"type": "commit"}))
                    except Exception: pass
                elif c == "stop":
                    try: up.send(bytes(32000)); up.send(json.dumps({"type": "commit"}))
                    except Exception: pass
                    time.sleep(3); send({"type": "closed"}); break
        except Exception: pass
        finally:
            st["alive"] = False
            try: st["up"] and st["up"].close()
            except Exception: pass
            stats.log("stt_stream", seconds=round(st["secs"], 1), segments=st["segs"], words=st.get("words", 0), language=code, context=bool(ctx["keyterms"] or ctx["topic"]), keyterms=len(ctx["keyterms"]))
