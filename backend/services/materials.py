"""Course material attached to a notebook (syllabus, slides, a textbook chapter, handouts).
It tells the AI what the notebook is about: the subject, its scope and its exact vocabulary."""
import json
from services import rag

def _rows(db, note_id):
    if note_id in (None, ""): return []
    try: return db.execute("SELECT id,name,summary,topics,terms FROM materials WHERE note_id=? ORDER BY id", (int(note_id),)).fetchall()
    except Exception: return []

def _j(v):
    try: return json.loads(v or "[]")
    except Exception: return []

def brief(db, note_id, limit=2500):
    """One line per uploaded item: name, what it covers, its main topics."""
    parts = []
    for r in _rows(db, note_id):
        t = _j(r["topics"]); parts.append(f"- “{r['name']}”: {r['summary'] or '(no summary yet)'}" + (f" Topics: {', '.join(t[:14])}." if t else ""))
    return "\n".join(parts)[:limit]

def vocabulary(db, note_id, n=80):
    """Key terms from all material, used to fix misheard words in dictation."""
    seen, out = set(), []
    for r in _rows(db, note_id):
        for t in _j(r["terms"]):
            t = str(t).strip()
            if t and t.lower() not in seen: seen.add(t.lower()); out.append(t)
    return out[:n]

def relevant(db, note_id, query, k=6, limit=4500):
    rows = _rows(db, note_id); names = {r["id"]: r["name"] for r in rows}
    if not names: return ""
    try: hits = rag.search_chunks(query, "material", list(names), k=k, db=db)
    except Exception as e: print("material retrieval failed:", e); return ""
    out, size = [], 0
    for h in hits:
        s = f"[from “{names.get(h['ref_id'], '?')}”] {h['chunk']}"
        if size + len(s) > limit: break
        out.append(s); size += len(s)
    return "\n\n".join(out)

def context(db, note_id, query, k=6, limit=4500):
    """A prompt block: what the notebook is about + the passages that matter for this request. Empty when nothing was uploaded."""
    b = brief(db, note_id)
    if not b: return ""
    rel = relevant(db, note_id, query, k, limit)
    return ("COURSE MATERIAL the student uploaded for this notebook (authoritative for the subject, its scope and the correct terms):\n" + b
            + (f"\n\nRELEVANT PASSAGES FROM THE MATERIAL:\n{rel}" if rel else ""))
