import os, tempfile
from flask import Blueprint, request, jsonify, Response
import config
from db import get_db, note_row
from services import gnani, llm, rag
bp = Blueprint("misc", __name__)
@bp.get("/status")
def status(): return jsonify(**llm.status(), voices=config.VOICES, catalog=config.CATALOG, default_voices=config.DEFAULT_VOICE, default_voice=config.GNANI_TTS_VOICE, tts_model=config.GNANI_TTS_MODEL)
@bp.get("/ai/check")
def ai_check(): return jsonify(llm.check())
@bp.get("/languages")
def languages(): return jsonify(config.LANGUAGES)
# /audio/transcribe now lives in routes/speech.py (Prisma v3, syllabus-aware)
def _tts_args():
    d = request.json or {}; text = (d.get("text") or "").strip()[:600]
    model = d.get("model") if d.get("model") in config.CATALOG else config.GNANI_TTS_MODEL
    voice = d.get("voice") if d.get("voice") in [v["name"] for v in config.CATALOG[model]] else config.DEFAULT_VOICE[model]   # voices differ per model
    lang = d.get("language") if d.get("language") in config.TTS_LANGS else "auto"
    try: speed = min(1.15, max(0.85, float(d.get("speed") or 1)))
    except (TypeError, ValueError): speed = 1.0
    return text, voice, model, lang, speed
@bp.post("/tts/stream")
def tts_stream():
    """Raw 24 kHz 16-bit mono PCM, streamed as Gnani produces it (the browser starts playing after the first chunk)."""
    text, voice, model, lang, speed = _tts_args()
    if not text: return jsonify(error="No text"), 400
    gen = gnani.synthesize_stream(text, voice, model, lang, speed)
    return Response(gen, mimetype="application/octet-stream", headers={"X-Sample-Rate": "24000", "Cache-Control": "no-store", "X-Accel-Buffering": "no"})
@bp.post("/tts")
def tts():
    text, voice, model, lang, speed = _tts_args()
    if not text: return jsonify(error="No text"), 400
    audio = gnani.synthesize(text, voice, model, lang, speed)
    audio, mime = gnani.as_playable(audio)
    return Response(audio, mimetype=mime, headers={"Cache-Control": "no-store"})
@bp.get("/search")
def semantic():
    q = request.args.get("q", "").strip()
    if not q: return jsonify([])
    db = get_db(); names = {r["id"]: r["title"] for r in db.execute("SELECT id,title FROM notes")}
    return jsonify([{"id": h["ref_id"], "title": names.get(h["ref_id"]), "snippet": h["chunk"][:160], "score": round(h["score"], 2)} for h in rag.search(q, k=8, db=db)])
@bp.post("/reindex")
def reindex(): rag.reindex_all(); return jsonify(ok=True, provider=rag.provider())
@bp.get("/graph")
def graph():
    db = get_db(); notes = [note_row(r, False) for r in db.execute("SELECT * FROM notes WHERE archived=0")]
    nodes, edges, tagset = [], [], {}
    for n in notes:
        nodes.append({"id": f"n{n['id']}", "type": "note", "label": n["title"], "note_id": n["id"], "category": n["category"]})
        for t in n["tags"]: tagset.setdefault(t.lower(), []).append(n["id"])
    for t, ids in tagset.items():
        nodes.append({"id": f"t:{t}", "type": "tag", "label": t})
        edges += [{"from": f"n{i}", "to": f"t:{t}", "kind": "tag"} for i in ids]
    seen = set()
    for n in notes:
        for h in rag.search(f"{n['title']} {n['summary_short']}", k=3, db=db, exclude=n["id"]):
            key = tuple(sorted((n["id"], h["ref_id"])))
            if h["score"] > 0.25 and key not in seen: seen.add(key); edges.append({"from": f"n{n['id']}", "to": f"n{h['ref_id']}", "kind": "related"})
    return jsonify(nodes=nodes, edges=edges)
