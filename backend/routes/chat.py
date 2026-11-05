import json, re
from flask import Blueprint, request, jsonify
from db import get_db, now
from services import llm, rag, sheets as sh, materials
bp = Blueprint("chat", __name__)
SYSTEM = """You are the user's Companion: a warm, knowledgeable friend who remembers what they have studied. Talk naturally, no corporate tone.
You get NOTE EXCERPTS (from the user's saved notes), an optional CURRENT OPEN NOTE, and PAST CHATS. Rules:
- When a statement comes from the current open note or another note excerpt, end it with its tag like [note:12].
- Treat CURRENT OPEN NOTE as the primary source whenever the user asks about the note currently on screen. Statements from your general knowledge get NO tag. Say plainly which is which ("your notes say..." vs "in general...").
- Use only note ids that appear in the excerpts. Never invent notes, facts or quotes. If unsure or notes don't cover it, say so.
- Explain simply with an analogy or example. If the user says they don't understand, try a different angle, don't repeat yourself.
- Understand follow-ups from the conversation history. Reply in the user's language.
- The open note is a notebook with several SHEETS (pages). Its text is labelled "=== Sheet N of M ===", and images/visuals appear as "[Image/Visual on this sheet: ...]". You know all of it: answer from it directly and mention sheet numbers when useful (e.g. "on sheet 2"). The person may also have SELECTED TEXT and a CURRENT SHEET; treat "this", "here" and "this part" as those.
- COURSE MATERIAL (when present) is the syllabus/slides/textbook the student uploaded for this notebook. Use it to answer accurately, in the course's own terms and scope, and say so ("your course material says..."); give it no tag. If the notes and the material disagree, point it out gently.
- Keep answers short and speakable (about 60-120 words) unless the user asks for depth: plain sentences, no markdown tables or headings, since answers are often read aloud."""
@bp.get("/chat/sessions")
def sessions():
    q = request.args.get("q", "").strip(); db = get_db()
    if q:
        rows = db.execute("SELECT DISTINCT s.* FROM sessions s LEFT JOIN messages m ON m.session_id=s.id WHERE s.title LIKE ? OR m.content LIKE ? ORDER BY s.updated DESC", (f"%{q}%", f"%{q}%"))
    else: rows = db.execute("SELECT * FROM sessions ORDER BY updated DESC")
    return jsonify([dict(r) for r in rows])
@bp.post("/chat/sessions")
def new_session():
    db = get_db(); t = now(); cur = db.execute("INSERT INTO sessions(title,created,updated) VALUES('New chat',?,?)", (t, t)); db.commit()
    return jsonify(id=cur.lastrowid, title="New chat"), 201
@bp.delete("/chat/sessions/<int:sid>")
def del_session(sid):
    db = get_db(); db.execute("DELETE FROM sessions WHERE id=?", (sid,)); db.execute("DELETE FROM messages WHERE session_id=?", (sid,))
    db.execute("DELETE FROM embeddings WHERE kind='chat' AND ref_id IN (SELECT id FROM messages WHERE session_id=?)", (sid,)); db.commit(); return "", 204
@bp.get("/chat/sessions/<int:sid>/messages")
def messages(sid):
    out = []
    for r in get_db().execute("SELECT * FROM messages WHERE session_id=? ORDER BY id", (sid,)):
        m = dict(r); m["sources"] = json.loads(m["sources"]); out.append(m)
    return jsonify(out)
def _plain(html_):
    import html
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", html_ or ""))).strip()

def _prepare(db, sid, text, note_id, sheet_index=None, selection="", voice=False):
    """Builds the LLM messages + sources. Retrieval problems never block an answer."""
    hist = db.execute("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 10", (sid,)).fetchall()[::-1]
    query = text if len(text) > 40 or not hist else f"{hist[-1]['content'][:200]} {text}"
    try: hits = rag.search(query, "note", k=4, db=db)
    except Exception as e: print("note retrieval failed:", e); hits = []
    titles = {r["id"]: r["title"] for r in db.execute("SELECT id,title FROM notes")}
    excerpts = "\n\n".join(f"[note:{h['ref_id']}] \"{titles.get(h['ref_id'], '?')}\": {h['chunk']}" for h in hits if h["ref_id"] != note_id) or "(no other relevant notes found)"
    current_title = None; ctx = ""
    if note_id is not None:
        cur = db.execute("SELECT id,title,content,sheets,summary_short,summary_detailed,key_points,definitions FROM notes WHERE id=?", (int(note_id),)).fetchone()
        if cur:
            current_title = cur["title"]
            try: sheets = sh.normalize(json.loads(cur["sheets"] or "[]"), cur["content"])
            except Exception: sheets = sh.normalize(None, cur["content"])
            where = f"\nThe person is currently on sheet {int(sheet_index) + 1} of {len(sheets)}." if isinstance(sheet_index, int) and 0 <= sheet_index < len(sheets) else ""
            picked = f"\nSELECTED TEXT: {selection[:1500]}" if selection else ""
            ctx = (f"\n\nCURRENT OPEN NOTE (highest-priority context):\n[note:{cur['id']}] {cur['title']}{where}{picked}\n"
                   f"Short summary: {cur['summary_short'] or ''}\nKey points: {cur['key_points'] or '[]'}\n\nFULL NOTEBOOK CONTENT:\n{sh.notebook_text(sheets, 20000)}")
    if note_id is not None:
        mat = materials.context(db, note_id, f"{selection[:300]} {query}".strip(), k=6, limit=5000)
        if mat: ctx += "\n\n" + mat
    try: past = [h for h in rag.search(text, "chat", k=3, db=db) if h["score"] > 0.2]
    except Exception: past = []
    past_txt = "\n".join("- " + h["chunk"][:300] for h in past) or "(none)"
    style = "\n\nVOICE CONVERSATION: your reply will be spoken aloud. Answer in at most 4 short plain sentences, no lists, no markdown, no note tags." if voice else ""
    msgs = [{"role": "system", "content": SYSTEM + style + f"\n\nNOTE EXCERPTS:\n{excerpts}" + ctx + f"\n\nPAST CHATS:\n{past_txt}"}] + [dict(r) for r in hist] + [{"role": "user", "content": text}]
    return msgs, hist, hits, titles, current_title

def _sources(hits, titles, reply, note_id, current_title):
    cited = {int(i) for i in re.findall(r"\[note:(\d+)\]", reply)}
    out = [{"id": h["ref_id"], "title": titles.get(h["ref_id"], "?"), "cited": h["ref_id"] in cited} for h in hits if h["score"] > 0.05 and h["ref_id"] != note_id]
    if current_title is not None: out.insert(0, {"id": int(note_id), "title": current_title, "cited": int(note_id) in cited})
    return out

def _save(db, sid, text, reply, sources, first):
    t = now(); cur = db.execute("INSERT INTO messages(session_id,role,content,created) VALUES(?,?,?,?)", (sid, "user", text, t))
    db.execute("INSERT INTO messages(session_id,role,content,sources,created) VALUES(?,?,?,?,?)", (sid, "assistant", reply, json.dumps(sources), t + 0.001))
    if first: db.execute("UPDATE sessions SET title=? WHERE id=?", (text[:48], sid))
    db.execute("UPDATE sessions SET updated=? WHERE id=?", (t, sid)); db.commit()
    try: rag.index("chat", cur.lastrowid, f"Q: {text} A: {reply}", db); db.commit()
    except Exception as e: print("chat index failed:", e)

@bp.post("/chat/sessions/<int:sid>/messages")
def send(sid):
    payload = request.json or {}; text = (payload.get("text") or "").strip(); note_id = payload.get("note_id")
    note_id = int(note_id) if note_id not in (None, "") else None
    if not text: return jsonify(error="Empty message"), 400
    db = get_db(); msgs, hist, hits, titles, ct = _prepare(db, sid, text, note_id, payload.get("sheet_index"), (payload.get("selection") or "")[:2000], bool(payload.get("voice")))
    reply = llm.chat(msgs, max_tokens=900).strip()
    sources = _sources(hits, titles, reply, note_id, ct); _save(db, sid, text, reply, sources, len(hist) == 0)
    return jsonify(role="assistant", content=reply, sources=sources)

@bp.post("/chat/sessions/<int:sid>/stream")
def stream(sid):
    """Server-sent events: {"delta": "..."} chunks, then {"done": true, "content": ..., "sources": [...]}; errors -> {"error": "..."}."""
    payload = request.json or {}; text = (payload.get("text") or "").strip(); note_id = payload.get("note_id")
    note_id = int(note_id) if note_id not in (None, "") else None
    if not text: return jsonify(error="Empty message"), 400
    from db import standalone
    db = standalone()
    def ev(o): return "data: " + json.dumps(o, ensure_ascii=False) + "\n\n"
    def gen():
        try:
            msgs, hist, hits, titles, ct = _prepare(db, sid, text, note_id, payload.get("sheet_index"), (payload.get("selection") or "")[:2000], bool(payload.get("voice"))); parts = []
            for d in llm.stream_chat(msgs, max_tokens=900): parts.append(d); yield ev({"delta": d})
            reply = "".join(parts).strip()
            sources = _sources(hits, titles, reply, note_id, ct); _save(db, sid, text, reply, sources, len(hist) == 0)
            yield ev({"done": True, "content": reply, "sources": sources})
        except Exception as e:
            yield ev({"error": str(e)})
        finally: db.close()
    from flask import Response
    return Response(gen(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
