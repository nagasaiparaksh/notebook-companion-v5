import json
from flask import Blueprint, request, jsonify, g
from db import get_db, note_row, now
from services import llm, rag, sheets as sh
bp = Blueprint("notes", __name__)
def _reindex(nid):
    n = get_db().execute("SELECT title,content,summary_detailed FROM notes WHERE id=?", (nid,)).fetchone()
    try: rag.index("note", nid, f"{n['title']}. {n['content']} {n['summary_detailed']}", get_db()); get_db().commit()
    except Exception as e: print("index failed:", e)
@bp.get("/notes")
def list_notes():
    q, view = request.args.get("q", "").strip(), request.args.get("view", "active")
    sql, args = "SELECT * FROM notes WHERE user_id=? AND archived=?", [g.uid, 1 if view == "archived" else 0]
    if q: sql += " AND (title LIKE ? OR content LIKE ? OR tags LIKE ? OR category LIKE ?)"; args += [f"%{q}%"] * 4
    sql += " ORDER BY pinned DESC, updated DESC"
    out = []
    for r in get_db().execute(sql, args):
        n = note_row(r, False); n["snippet"] = sh.plain_text(r["content"])[:160]
        try: n["sheet_count"] = max(1, len(json.loads(r["sheets"] or "[]")))
        except Exception: n["sheet_count"] = 1
        out.append(n)
    return jsonify(out)
@bp.post("/notes")
def create():
    d = request.json or {}; t = now(); db = get_db()
    title = d.get("title") if isinstance(d.get("title"), str) and d.get("title").strip() else "Untitled notebook"
    sheets = sh.normalize(d.get("sheets"), d.get("content", ""))
    cur = db.execute("INSERT INTO notes(title,content,sheets,language,category,tags,created,updated,user_id) VALUES(?,?,?,?,?,?,?,?,?)",
        (title, sh.content_from(sheets), json.dumps(sheets), d.get("language", "en-IN"), d.get("category", ""), json.dumps(d.get("tags", [])), t, t, g.uid))
    db.commit(); _reindex(cur.lastrowid)
    return jsonify(note_row(db.execute("SELECT * FROM notes WHERE id=?", (cur.lastrowid,)).fetchone())), 201
@bp.get("/notes/<int:nid>")
def get(nid):
    db = get_db(); r = db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not r: return jsonify(error="Note not found"), 404
    n = note_row(r); n["sheets"] = sh.normalize(n.get("sheets"), n.get("content", "")); n["tasks"] = [dict(t) for t in db.execute("SELECT * FROM tasks WHERE note_id=?", (nid,))]
    try:
        rel = rag.search(f"{n['title']}. {n['summary_short']} {n['content'][:500]}", k=4, exclude=nid)
        names = {x["id"]: x["title"] for x in db.execute("SELECT id,title FROM notes WHERE user_id=?", (g.uid,))}
        n["related"] = [{"id": x["ref_id"], "title": names.get(x["ref_id"], "?"), "score": round(x["score"], 2)} for x in rel if x["score"] > 0.05]
    except Exception: n["related"] = []
    return jsonify(n)
@bp.put("/notes/<int:nid>")
def update(nid):
    d = request.json or {}; db = get_db(); sets, args = [], []
    if "sheets" in d:
        sheets = sh.normalize(d["sheets"]); sets += ["sheets=?", "content=?"]; args += [json.dumps(sheets), sh.content_from(sheets)]
    elif "content" in d:
        sheets = sh.normalize(None, d["content"]); sets += ["sheets=?", "content=?"]; args += [json.dumps(sheets), sh.content_from(sheets)]
    for f in ("title", "language", "category", "summary_short", "summary_detailed", "pinned", "archived", "transcript"):
        if f in d: sets.append(f"{f}=?"); args.append(d[f])
    for f in ("tags", "key_points", "definitions", "diagram_ids"):
        if f in d: sets.append(f"{f}=?"); args.append(json.dumps(d[f]))
    if sets:
        db.execute(f"UPDATE notes SET {','.join(sets)}, updated=? WHERE id=?", args + [now(), nid]); db.commit()
    if "sheets" in d or "content" in d or "title" in d:
        _reindex(nid)
        import threading; from services import backup
        threading.Thread(target=backup.snapshot, daemon=True).start()     # cheap no-op unless the newest backup is 6+ hours old
    if "tasks" in d:
        db.execute("DELETE FROM tasks WHERE note_id=?", (nid,))
        for t in d["tasks"]: db.execute("INSERT INTO tasks(note_id,text,deadline,done) VALUES(?,?,?,?)", (nid, t["text"], t.get("deadline", ""), int(t.get("done", 0))))
        db.commit()
    return get(nid)
@bp.delete("/notes/<int:nid>")
def delete(nid):
    db = get_db()
    for q in ("DELETE FROM notes WHERE id=?", "DELETE FROM tasks WHERE note_id=?"): db.execute(q, (nid,))
    db.execute("DELETE FROM embeddings WHERE kind='note' AND ref_id=?", (nid,))
    db.execute("DELETE FROM embeddings WHERE kind='material' AND ref_id IN (SELECT id FROM materials WHERE note_id=?)", (nid,)); db.execute("DELETE FROM materials WHERE note_id=?", (nid,)); db.execute("DELETE FROM coverage WHERE note_id=?", (nid,))
    db.commit(); return "", 204
PROCESS_PROMPT = """You turn raw text (maybe a lecture/meeting transcript) into a structured study note.
Write ALL output in the language of the source text unless told otherwise (target: {lang}). Do not invent facts not in the text.
Return ONLY JSON: {{"title":str,"category":str,"tags":[str],"summary_short":str(1-2 sentences),"summary_detailed":str,
"key_points":[str],"definitions":[{{"term":str,"meaning":str}}],"tasks":[{{"text":str,"deadline":str}}],"content_html":str}}
content_html: clean HTML with <h2>, <p>, <ul><li> only. tasks may be empty; deadline "" if none."""
def process_text(text, lang):
    return llm.chat_json([{"role": "system", "content": PROCESS_PROMPT.format(lang=lang)}, {"role": "user", "content": text[:12000]}])
@bp.post("/notes/intent")
def classify_intent():
    d = request.json or {}; utterance = (d.get("text") or "").strip()
    if not utterance: return jsonify(error="No spoken text to classify"), 400
    prompt = """Classify the user's utterance for a voice-first study notebook.
Return ONLY JSON: {"intent":"note"|"diagram"|"question"|"action","diagram_prompt":str,"reason":str}.
Use diagram when the user asks to see, draw, visualize, or generate how something looks or works (e.g. "I want to see how an amoeba looks like").
Use question when they ask for an explanation or answer. Use action for app commands such as archive, search, or delete. Use note when they are dictating lecture content, facts, or personal notes.
Do not turn dictated educational content into a command just because it contains imperative words."""
    try:
        result = llm.chat_json([{"role":"system","content":prompt},{"role":"user","content":utterance[:3000]}])
        if result.get("intent") not in ("note","diagram","question","action"): result["intent"] = "note"
        result.setdefault("diagram_prompt", utterance)
        return jsonify(result)
    except Exception:
        # Deterministic fallback keeps capture usable when the model is unavailable.
        import re
        is_diagram = bool(re.search(r"\\b(i want to see how|show me how|show me what|what does .+ look like|draw|generate (an? )?diagram|make (an? )?diagram|create (an? )?diagram)\\b", utterance, re.I))
        return jsonify(intent="diagram" if is_diagram else "note", diagram_prompt=utterance, fallback=True)

@bp.post("/notes/process")
def process_new():
    d = request.json or {}; text = (d.get("text") or "").strip()
    if not text: return jsonify(error="No text to process"), 400
    p = process_text(text, d.get("language", "en-IN")); t = now(); db = get_db()
    cur = db.execute("INSERT INTO notes(title,content,language,category,tags,summary_short,summary_detailed,key_points,definitions,transcript,created,updated,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (p.get("title", "Untitled"), p.get("content_html", ""), d.get("language", "en-IN"), p.get("category", ""), json.dumps(p.get("tags", [])),
         p.get("summary_short", ""), p.get("summary_detailed", ""), json.dumps(p.get("key_points", [])), json.dumps(p.get("definitions", [])), text, t, t, g.uid))
    nid = cur.lastrowid
    for k in p.get("tasks", []): db.execute("INSERT INTO tasks(note_id,text,deadline) VALUES(?,?,?)", (nid, k.get("text", ""), k.get("deadline", "")))
    db.commit(); _reindex(nid); return get(nid)
@bp.post("/notes/<int:nid>/process")
def process_existing(nid):
    db = get_db(); n = db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not n: return jsonify(error="Note not found"), 404
    p = process_text(f"{n['title']}\n{n['content']}", n["language"])
    db.execute("UPDATE notes SET category=?,tags=?,summary_short=?,summary_detailed=?,key_points=?,definitions=?,updated=? WHERE id=?",
        (p.get("category", ""), json.dumps(p.get("tags", [])), p.get("summary_short", ""), p.get("summary_detailed", ""),
         json.dumps(p.get("key_points", [])), json.dumps(p.get("definitions", [])), now(), nid))
    db.execute("DELETE FROM tasks WHERE note_id=?", (nid,))
    for k in p.get("tasks", []): db.execute("INSERT INTO tasks(note_id,text,deadline) VALUES(?,?,?)", (nid, k.get("text", ""), k.get("deadline", "")))
    db.commit(); _reindex(nid); return get(nid)
@bp.post("/notes/<int:nid>/translate")
def translate(nid):
    lang = (request.json or {}).get("language"); n = get_db().execute("SELECT title,content FROM notes WHERE id=?", (nid,)).fetchone()
    if not n or not lang: return jsonify(error="Note and target language required"), 400
    out = llm.chat([{"role": "system", "content": f"Translate into {lang}. Keep HTML tags unchanged. Output only the translation."},
                    {"role": "user", "content": f"<h1>{n['title']}</h1>{n['content']}"}])
    return jsonify(translation=out)
