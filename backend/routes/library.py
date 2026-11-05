"""Things that make the app easy to adopt and worth switching to:
- live lecture mode: a long recording's transcript -> organized study notes
- syllabus coverage: which course-material topics the notes already cover
- Word / Markdown / text import into sheets
- backups: automatic snapshots, plus a one-file download / restore of the whole library"""
import html as _html, io, json, re, time, zipfile
import xml.etree.ElementTree as ET
from flask import Blueprint, request, jsonify, Response
from db import get_db, now
from services import llm, rag, materials, backup, stats, sheets as sh
bp = Blueprint("library", __name__)
_s = lambda v, n: str(v or "").strip()[:n]

# ======================================================================= live lecture -> notes
LECTURE = """You turn the raw transcript of a class lecture into clear study notes for a student. The transcript comes from speech recognition:
expect misheard words, filler, repetition, half sentences and code-mixed speech (e.g. Hindi/Telugu mixed with English). Return ONLY JSON:
{"title":str (<=8 words), "say":str (<=20 words, past tense: what you made),
 "blocks":[ {"type":"heading","text":str} | {"type":"subheading","text":str} | {"type":"paragraph","text":str} | {"type":"bullets","items":[str]} | {"type":"numbered","items":[str]} ],
 "key_terms":[{"term":str,"meaning":str (<=20 words)}],
 "follow_up":[str (up to 3 points the student should review or ask the teacher, because the lecture was unclear or incomplete there)]}
Rules:
- Organize by topic in the order it was taught, with clear headings. Use bullets for lists of points, numbered items for steps.
- Keep EVERY fact, definition, example, formula, number and date the lecturer gave. Put announcements (assignments, deadlines, exam hints) under a heading "Announcements".
- Fix speech-recognition errors, especially technical terms, using the SUBJECT VOCABULARY / COURSE MATERIAL when given. Drop filler, repetition and off-topic chatter.
- Lines may start with "Teacher:" or "Student N:" (speaker labels from the recording). Notes come from what the teacher taught; put students' questions with the teacher's answers under a heading "Questions from class".
- Do not add facts the lecturer did not say (except correcting an obviously misheard term). Write the notes in {lang}."""

def _parts(text, size=22000):
    out, cur = [], ""
    for s in re.split(r"(?<=[.!?।])\s+", text):
        if len(cur) + len(s) > size and cur: out.append(cur); cur = ""
        cur += (" " if cur else "") + s
    return out + ([cur] if cur else [])

def _blocks(raw):
    out = []
    for b in (raw or [])[:80]:
        if not isinstance(b, dict): continue
        t = b.get("type")
        if t in ("heading", "subheading", "paragraph") and _s(b.get("text"), 3): out.append({"type": t, "text": _s(b.get("text"), 120 if t != "paragraph" else 1200)})
        elif t in ("bullets", "numbered"):
            items = [_s(i, 400) for i in (b.get("items") or []) if _s(i, 2)][:20]
            if items: out.append({"type": t, "items": items})
    return out

@bp.post("/lecture/notes")
def lecture_notes():
    d = request.json or {}; text = re.sub(r"\s+", " ", str(d.get("transcript") or "")).strip(); nid = d.get("note_id")
    if len(text.split()) < 25: return jsonify(error="The recording is too short to make notes from yet (fewer than 25 words were heard)."), 400
    text = text[:150000]; lang = _s(d.get("notes_language"), 40) or "English (use the lecture's own language only if it was entirely in one non-English language)"
    db = get_db(); vocab = materials.vocabulary(db, nid) if nid else []
    blocks, terms, follow, title, say = [], [], [], "", ""
    parts = _parts(text)
    for k, part in enumerate(parts):
        mat = materials.context(db, nid, part[:3000], k=5, limit=4000) if nid else ""
        user = (f"PART {k + 1} OF {len(parts)} OF THE TRANSCRIPT\n" if len(parts) > 1 else "") + f"TRANSCRIPT:\n{part}" \
               + (f"\n\nSUBJECT VOCABULARY: {', '.join(vocab)}" if vocab else "") + (f"\n\n{mat}" if mat else "")
        try: j = llm.chat_json([{"role": "system", "content": LECTURE.replace("{lang}", lang)}, {"role": "user", "content": user}], max_tokens=8000, timeout=(6, 150))
        except Exception as e:
            if not blocks: return jsonify(error="The AI couldn't turn the lecture into notes right now: " + str(e)[:160] + ". Your transcript is kept, so you can try again."), 503
            break
        title = title or _s(j.get("title"), 80); say = say or _s(j.get("say"), 200); blocks += _blocks(j.get("blocks"))
        for t in j.get("key_terms") or []:
            if isinstance(t, dict) and _s(t.get("term"), 2) and not any(x["term"].lower() == _s(t.get("term"), 80).lower() for x in terms): terms.append({"term": _s(t.get("term"), 80), "meaning": _s(t.get("meaning"), 200)})
        follow += [_s(f, 200) for f in (j.get("follow_up") or []) if _s(f, 3)]
    if not blocks: return jsonify(error="The AI's notes weren't usable. Please try again; your transcript is kept."), 503
    stats.log("lecture_notes", words=len(text.split()), blocks=len(blocks), terms=len(terms))
    return jsonify({"title": title, "say": say or "Turned the lecture into notes.", "blocks": blocks, "key_terms": terms[:30], "follow_up": follow[:5]})

# ======================================================================= syllabus coverage
COVER = """You check a student's notes against the topics of their course (taken from the syllabus / slides they uploaded).
For EACH topic in the numbered list decide, using ONLY what the NOTES say:
"covered" = the notes explain it properly; "partial" = mentioned but thin or incomplete; "missing" = not in the notes.
Return ONLY JSON: {"topics":[{"n":number,"status":"covered"|"partial"|"missing","sheet":number|null (where the notes cover it),"hint":str (<=15 words: what to add; "" when covered)}]}
Judge by meaning, not exact words. Give one entry per topic, in the same order."""
_STOP = set("the and for with from into using their this that what how why are was were of to in on a an by as or its is be".split())

def _topics(db, nid):
    seen, out = set(), []
    for r in db.execute("SELECT topics FROM materials WHERE note_id=? ORDER BY id", (nid,)):
        for t in json.loads(r["topics"] or "[]"):
            k = re.sub(r"\W+", " ", str(t).lower()).strip()
            if k and k not in seen: seen.add(k); out.append(str(t).strip())
    return out[:30]

def _keyword_cover(topics, text):
    low = re.sub(r"\W+", " ", text.lower()); res = []
    for i, t in enumerate(topics, 1):
        words = [w for w in re.findall(r"\w+", t.lower()) if len(w) > 2 and w not in _STOP] or re.findall(r"\w+", t.lower())
        f = sum(1 for w in words if re.search(rf"\b{re.escape(w[:max(4, len(w) - 2)])}", low)) / max(1, len(words))
        res.append({"n": i, "status": "covered" if f >= 0.75 else "partial" if f >= 0.34 else "missing", "sheet": None, "hint": ""})
    return res

def _cov_row(db, nid):
    r = db.execute("SELECT data FROM coverage WHERE note_id=?", (nid,)).fetchone()
    return json.loads(r["data"]) if r else None

@bp.get("/notes/<int:nid>/coverage")
def coverage_get(nid): return jsonify(_cov_row(get_db(), nid) or {})

@bp.post("/notes/<int:nid>/coverage")
def coverage(nid):
    db = get_db(); topics = _topics(db, nid)
    if not topics: return jsonify(error="Add course material first (📚 Material): coverage is measured against its topics."), 400
    row = db.execute("SELECT title,content,sheets FROM notes WHERE id=?", (nid,)).fetchone()
    if not row: return jsonify(error="Notebook not found."), 404
    try: sheets = sh.normalize(json.loads(row["sheets"] or "[]"), row["content"])
    except Exception: sheets = sh.normalize(None, row["content"])
    text = sh.notebook_text(sheets, 20000); method = "ai"
    if len(re.sub(r"=== Sheet \d+ of \d+ ===|\(empty\)|\s", "", text)) < 30: res = [{"n": i, "status": "missing", "sheet": None, "hint": ""} for i in range(1, len(topics) + 1)]; method = "empty"
    else:
        try:
            j = llm.chat_json([{"role": "system", "content": COVER}, {"role": "user", "content": "TOPICS:\n" + "\n".join(f"{i}. {t}" for i, t in enumerate(topics, 1)) + f"\n\nNOTES (notebook “{row['title']}”):\n{text}"}], max_tokens=3000, timeout=(6, 60))
            got = {int(x.get("n")): x for x in (j.get("topics") or []) if isinstance(x, dict) and str(x.get("n", "")).isdigit()}
            res = [{"n": i, "status": got[i].get("status") if got.get(i, {}).get("status") in ("covered", "partial", "missing") else "missing",
                    "sheet": got.get(i, {}).get("sheet") if isinstance(got.get(i, {}).get("sheet"), int) else None, "hint": _s(got.get(i, {}).get("hint"), 120)} for i in range(1, len(topics) + 1)]
            if not got: raise ValueError("no topics in the answer")
        except Exception: res = _keyword_cover(topics, text); method = "keywords"       # still useful without the AI
    items = [{"topic": t, **{k: v for k, v in r.items() if k != "n"}} for t, r in zip(topics, res)]
    c = sum(1 for x in items if x["status"] == "covered"); p = sum(1 for x in items if x["status"] == "partial")
    out = {"topics": items, "covered": c, "partial": p, "total": len(items), "percent": round(100 * (c + 0.5 * p) / len(items)), "method": method, "checked": now()}
    db.execute("INSERT OR REPLACE INTO coverage(note_id,data,created) VALUES(?,?,?)", (nid, json.dumps(out), now())); db.commit()
    stats.log("coverage", percent=out["percent"], total=out["total"], method=method)
    return jsonify(out)

# ======================================================================= Word / Markdown / text import
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SHEET_CHARS = 1700

def _runs(p):
    out = []
    for r in p.iter():
        if r.tag == W + "r":
            rp = r.find(W + "rPr"); on = lambda tag: rp is not None and rp.find(W + tag) is not None and rp.find(W + tag).get(W + "val") not in ("0", "false")
            txt = ""
            for c in r:
                if c.tag == W + "t": txt += c.text or ""
                elif c.tag == W + "tab": txt += " "
                elif c.tag == W + "br" and c.get(W + "type") != "page": txt += "\n"
            if not txt: continue
            h = _html.escape(txt).replace("\n", "<br>")
            if on("b"): h = f"<b>{h}</b>"
            if on("i"): h = f"<i>{h}</i>"
            if on("u"): h = f"<u>{h}</u>"
            out.append(h)
    return "".join(out).strip()

def _docx_blocks(b, problems):
    """-> list of (html, text_len, is_heading, page_break_before)"""
    try:
        with zipfile.ZipFile(io.BytesIO(b)) as z:
            root = ET.fromstring(z.read("word/document.xml")); pics = sum(1 for f in z.namelist() if f.startswith("word/media/"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError): raise ValueError("That Word file couldn't be opened. (Old .doc files: save as .docx first.)")
    body = root.find(W + "body"); out, lst = [], None
    def flush_list():
        nonlocal lst
        if lst: out.append(("<ul>" + "".join(f"<li>{x}</li>" for x in lst) + "</ul>", sum(len(re.sub(r"<[^>]+>", "", x)) for x in lst), False, False)); lst = None
    for el in body if body is not None else []:
        if el.tag == W + "p":
            ppr = el.find(W + "pPr"); style = (ppr.find(W + "pStyle").get(W + "val") if ppr is not None and ppr.find(W + "pStyle") is not None else "") or ""
            brk = any(x.get(W + "type") == "page" for x in el.iter(W + "br")) or (ppr is not None and ppr.find(W + "pageBreakBefore") is not None)
            h = _runs(el); plain = re.sub(r"<[^>]+>", "", h).strip()
            if ppr is not None and ppr.find(W + "numPr") is not None and plain: lst = (lst or []) + [h]; continue
            flush_list()
            if not plain:
                if brk: out.append(("", 0, False, True))
                continue
            head = bool(re.match(r"(Heading|Title|Subtitle)", style, re.I))
            out.append((f"<h2>{re.sub(r'</?b>', '', h)}</h2>" if head else f"<p>{h}</p>", len(plain), head, brk))
        elif el.tag == W + "tbl":
            flush_list(); rows = []
            for tr in el.iter(W + "tr"):
                cells = [" ".join(_runs(p) for p in tc.iter(W + "p")).strip() for tc in tr.iter(W + "tc")]
                if any(re.sub(r"<[^>]+>", "", c).strip() for c in cells): rows.append(" — ".join(cells))
            if rows: out.append(("<ul>" + "".join(f"<li>{r}</li>" for r in rows) + "</ul>", sum(len(r) for r in rows), False, False))
    flush_list()
    if pics: problems.append(f"{pics} picture(s) in the document weren't brought in; paste them onto the sheets if you need them")
    return out

def _md_blocks(t):
    out, lst = [], None
    def flush():
        nonlocal lst
        if lst: out.append(("<ul>" + "".join(f"<li>{x}</li>" for x in lst) + "</ul>", sum(len(x) for x in lst), False, False)); lst = None
    inl = lambda s: re.sub(r"\*(?!\s)([^*]+?)\*", r"<i>\1</i>", re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", _html.escape(s)))
    for para in re.split(r"\n\s*\n|\n(?=\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s))", t.replace("\r", "")):
        for line in [para] if not re.match(r"\s*([-*+]|\d+[.)])\s", para) else para.split("\n"):
            l = line.strip()
            if not l: continue
            m = re.match(r"(#{1,6})\s+(.*)", l); li = re.match(r"(?:[-*+]|\d+[.)])\s+(.*)", l)
            if li: lst = (lst or []) + [inl(li.group(1))]; continue
            flush()
            if m: out.append((f"<h2>{_html.escape(m.group(2))}</h2>", len(m.group(2)), True, False))
            elif l in ("---", "***", "\f"): out.append(("", 0, False, True))
            else: one = re.sub(r"\s*\n\s*", " ", l); out.append((f"<p>{inl(one)}</p>", len(l), False, False))
    flush(); return out

def _to_sheets(blocks):
    """Group blocks into sheets: a new sheet at a page break, or before a heading once the sheet is half full, or when it is full."""
    sheets, cur, size = [], [], 0
    for h, n, head, brk in blocks:
        if cur and (brk or size + n > SHEET_CHARS or (head and size > SHEET_CHARS * 0.5)): sheets.append("".join(cur)); cur, size = [], 0
        if h: cur.append(h); size += n
    if cur: sheets.append("".join(cur))
    return [s for s in sheets if re.sub(r"<[^>]+>", "", s).strip()]

@bp.post("/import/document")
def import_document():
    f = request.files.get("file")
    if not f: return jsonify(error="No file."), 400
    name = (f.filename or "").lower(); b = f.read(); problems = []
    try:
        if name.endswith(".docx"): blocks = _docx_blocks(b, problems)
        elif name.endswith((".md", ".markdown", ".txt")): blocks = _md_blocks(b.decode("utf-8", "ignore"))
        elif name.endswith(".doc"): return jsonify(error="Old .doc files can't be read. In Word: File → Save As → Word Document (.docx), then import that."), 400
        else: return jsonify(error="Import a Word document (.docx), Markdown (.md) or text (.txt) file. For PDFs and photos use “Photo or PDF of notes”."), 400
    except ValueError as e: return jsonify(error=str(e)), 400
    sheets = _to_sheets(blocks)
    if not sheets: return jsonify(error="That document seems to be empty."), 422
    return jsonify({"sheets": sheets, "title": re.sub(r"\.(docx|md|markdown|txt)$", "", f.filename or "Imported document", flags=re.I)[:120], "problems": problems})

# ======================================================================= backups
@bp.get("/backup/status")
def backup_status(): return jsonify(backup.status())

@bp.post("/backup/now")
def backup_now():
    name = backup.snapshot(force=True)
    return (jsonify({**backup.status(), "file": name}) if name else (jsonify(error="The backup couldn't be written. Check that the backup folder exists and is writable."), 500))

@bp.get("/backup/export")
def export_library():
    """Every notebook (or one, with ?note_id=) and its course material as one JSON file the person keeps."""
    db = get_db(); nid = request.args.get("note_id", type=int)
    rows = db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchall() if nid else db.execute("SELECT * FROM notes ORDER BY id").fetchall()
    books = []
    for r in rows:
        try: sheets = json.loads(r["sheets"] or "[]")
        except Exception: sheets = []
        mats = [{k: m[k] for k in ("name", "kind", "text", "summary", "topics", "terms", "chars", "pages", "pages_read")} for m in db.execute("SELECT * FROM materials WHERE note_id=?", (r["id"],))]
        books.append({"title": r["title"], "language": r["language"], "sheets": sh.normalize(sheets, r["content"]), "pinned": r["pinned"], "created": r["created"], "updated": r["updated"], "materials": mats})
    data = json.dumps({"app": "notebook-companion", "version": 1, "exported": now(), "notebooks": books}, ensure_ascii=False)
    fname = time.strftime("notebook-backup-%Y-%m-%d.json") if not nid else re.sub(r"[^\w\- ]+", "", (rows[0]["title"] if rows else "notebook"))[:60] + ".notebook.json"
    return Response(data, mimetype="application/json", headers={"Content-Disposition": f'attachment; filename="{fname}"', "Cache-Control": "no-store"})

@bp.post("/backup/import")
def import_library():
    """Restore notebooks from a backup file. Nothing is overwritten: notebooks you already have are skipped, others are added."""
    f = request.files.get("file")
    try: data = json.loads((f.read() if f else b"").decode("utf-8"))
    except Exception: return jsonify(error="That isn't a Notebook Companion backup file (.json)."), 400
    if not isinstance(data, dict) or data.get("app") != "notebook-companion": return jsonify(error="That isn't a Notebook Companion backup file."), 400
    db = get_db(); have = {(r["title"], r["sheets"]) for r in db.execute("SELECT title,sheets FROM notes")}; titles = {t for t, _ in have}
    added, skipped = 0, 0
    for b in data.get("notebooks") or []:
        if not isinstance(b, dict): continue
        sheets = sh.normalize(b.get("sheets")); sj = json.dumps(sheets); title = _s(b.get("title"), 120) or "Restored notebook"
        if (title, sj) in have: skipped += 1; continue
        if title in titles: title = f"{title} (restored)"
        t = now(); cur = db.execute("INSERT INTO notes(title,content,sheets,language,pinned,created,updated) VALUES(?,?,?,?,?,?,?)",
                                    (title, sh.content_from(sheets), sj, _s(b.get("language"), 10) or "en-IN", 1 if b.get("pinned") else 0, b.get("created") or t, t))
        nid = cur.lastrowid; rag.index("note", nid, f"{title}. {sh.content_from(sheets)}", db)
        for m in b.get("materials") or []:
            if not isinstance(m, dict) or not m.get("text"): continue
            mc = db.execute("INSERT INTO materials(note_id,name,kind,text,summary,topics,terms,chars,pages,pages_read,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                            (nid, _s(m.get("name"), 120), _s(m.get("kind"), 20), str(m["text"]), _s(m.get("summary"), 600), m.get("topics") if isinstance(m.get("topics"), str) else json.dumps(m.get("topics") or []),
                             m.get("terms") if isinstance(m.get("terms"), str) else json.dumps(m.get("terms") or []), int(m.get("chars") or len(m["text"])), int(m.get("pages") or 0), int(m.get("pages_read") or 0), t))
            rag.index("material", mc.lastrowid, str(m["text"]), db)
        added += 1
    db.commit()
    return jsonify({"added": added, "skipped": skipped})
