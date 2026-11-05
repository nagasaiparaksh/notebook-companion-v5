"""What Gnani Prisma v3 is told before it listens: the course's own terms (keyterms), a short description of the subject (topic)
and what was just said (previous_text). This is what makes recognition syllabus-aware."""
import json, re
from services import materials

def build(db, note_id=None, extra_terms=None, previous_text=""):
    keyterms, topic = [], ""
    if note_id not in (None, ""):
        try:
            r = db.execute("SELECT title FROM notes WHERE id=?", (int(note_id),)).fetchone()
            title = r["title"] if r else ""
            keyterms += materials.vocabulary(db, note_id, n=160)
            for m in db.execute("SELECT topics FROM materials WHERE note_id=?", (int(note_id),)):
                keyterms += [t for t in json.loads(m["topics"] or "[]")]
            brief = materials.brief(db, note_id, limit=1400)
            topic = (f"A student's class notes for “{title}”. " if title and title != "Untitled notebook" else "A student's class notes. ") + (f"The course covers: {brief}" if brief else "")
        except Exception as e: print("speech context failed:", e)
    keyterms += [str(t) for t in (extra_terms or [])]
    seen, terms = set(), []
    for t in keyterms:
        t = re.sub(r"\s+", " ", str(t)).strip(" .,:;")[:60]
        if 1 < len(t) and t.lower() not in seen: seen.add(t.lower()); terms.append(t)
    return {"keyterms": terms[:200], "topic": topic.strip()[:1600] if len(topic.strip()) >= 30 else "", "previous_text": (previous_text or "")[-600:]}
