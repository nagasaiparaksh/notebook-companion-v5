"""Course material for a notebook: upload a syllabus, slides, a textbook chapter or a handout (PDF, Word, PowerPoint, text, photo)
so the AI knows what the notebook is about. The text is stored, indexed for retrieval, and summarised into a short brief."""
import base64, html as _html, io, json, re, zipfile
from flask import Blueprint, request, jsonify
from db import get_db, now
from services import llm, rag
bp = Blueprint("materials", __name__)
MAX_CHARS, MAX_PDF_PAGES, MAX_OCR_PAGES = 300_000, 150, 40

READ_PROMPT = """Transcribe all readable text on this page of course material (a slide, textbook page, handout, whiteboard or notes).
Keep the original language, wording and order; put headings on their own line. For a diagram or figure write [Diagram: one short description including its labels].
Return only the text, no commentary. If nothing is readable, return exactly: EMPTY"""
BRIEF = """You are briefing a tutor who will help a student take and improve notes for a course. From the COURSE MATERIAL below return ONLY JSON:
{"summary":str (2-3 sentences: the subject, the level, what this material covers),
 "topics":[5-15 main topics in the order they appear, each <=6 words],
 "terms":[up to 40 key technical terms, names, acronyms and formulas spelled exactly as in the material]}
Write in the language of the material."""

def _ocr(data_url):
    out = (llm.chat([{"role": "user", "content": [{"type": "text", "text": READ_PROMPT}, {"type": "image_url", "image_url": {"url": data_url}}]}],
                    temperature=0.1, max_tokens=4000, timeout=(8, 90)) or "").strip()
    return "" if out.upper() == "EMPTY" else out

def _xml_text(xml, para):
    xml = re.sub(r"<w:tab/>|<a:tab/>", " ", xml); xml = re.sub(rf"</{para}>", "\n", xml)
    return _html.unescape(re.sub(r"<[^>]+>", "", xml))

def _pdf(b, problems, meta):
    try:
        try: import pymupdf as fitz
        except ImportError: import fitz
    except ImportError: raise ValueError("Reading PDFs needs one extra package. Run: pip install pymupdf  (then restart Flask).")
    try: doc = fitz.open(stream=b, filetype="pdf")
    except Exception: raise ValueError("That PDF couldn't be opened (is it password-protected or damaged?).")
    texts, scans = {}, []
    for i, pg in enumerate(doc):
        if i >= MAX_PDF_PAGES: problems.append(f"only the first {MAX_PDF_PAGES} of {len(doc)} pages were read"); break
        t = (pg.get_text() or "").strip()
        if len(t) >= 80: texts[i] = t
        else: scans.append((i, t, "data:image/jpeg;base64," + base64.b64encode(pg.get_pixmap(dpi=130).tobytes("jpeg")).decode()) if len(scans) < MAX_OCR_PAGES else (i, t, None))
    # scanned pages are read by the AI's vision, 4 at a time, so a whole scanned unit finishes in a minute or two
    from concurrent.futures import ThreadPoolExecutor
    def read(job):
        i, t, img = job
        if img is None: return i, t, "skipped"
        try: return i, _ocr(img) or t, None
        except Exception as e: return i, t, str(e)[:80]
    skipped = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, t, err in ex.map(read, scans):
            if err == "skipped": skipped += 1
            elif err: problems.append(f"page {i + 1} couldn't be read ({err})")
            if t: texts[i] = t
    if skipped: problems.append(f"{skipped} scanned page(s) were skipped (at most {MAX_OCR_PAGES} scanned pages are read per file)")
    meta["pages"], meta["read"] = min(len(doc), MAX_PDF_PAGES) if len(doc) <= MAX_PDF_PAGES else len(doc), len(texts)
    return "\n\n".join(f"[Page {i + 1}]\n{texts[i]}" for i in sorted(texts))

def extract(name, mime, b, problems, meta):
    n = (name or "").lower()
    if n.endswith(".pdf") or mime == "application/pdf": return _pdf(b, problems, meta), "pdf"
    if n.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(b)) as z: return _xml_text(z.read("word/document.xml").decode("utf-8", "ignore"), "w:p"), "word"
        except (zipfile.BadZipFile, KeyError): raise ValueError("That Word file couldn't be opened.")
    if n.endswith(".pptx"):
        try:
            with zipfile.ZipFile(io.BytesIO(b)) as z:
                slides = sorted((int(m.group(1)), f) for f in z.namelist() if (m := re.fullmatch(r"ppt/slides/slide(\d+)\.xml", f))); meta["pages"] = meta["read"] = len(slides)
                return "\n\n".join(f"[Slide {k}]\n{_xml_text(z.read(f).decode('utf-8', 'ignore'), 'a:p').strip()}" for k, f in slides), "slides"
        except zipfile.BadZipFile: raise ValueError("That PowerPoint file couldn't be opened.")
    if n.endswith((".doc", ".ppt")): raise ValueError("Old .doc/.ppt files can't be read. Save it as .docx / .pptx or PDF first.")
    if mime.startswith("image/") or n.endswith((".jpg", ".jpeg", ".png", ".webp")):
        if len(b) > 12_000_000: raise ValueError("That photo is too large.")
        t = _ocr(f"data:{mime if mime.startswith('image/') else 'image/jpeg'};base64," + base64.b64encode(b).decode())
        if not t: raise ValueError("I couldn't find readable text in that photo. Try a sharper, straight-on photo.")
        return t, "photo"
    if n.endswith((".txt", ".md", ".markdown", ".csv", ".rtf")) or mime.startswith("text/"):
        t = b.decode("utf-8", "ignore")
        if n.endswith((".html", ".htm")) or "<html" in t[:500].lower(): t = _html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", "", t, flags=re.S | re.I)))
        return t, "text"
    raise ValueError("That file type isn't supported. Use PDF, Word (.docx), PowerPoint (.pptx), text/Markdown, or a photo.")

def _row(r):
    m = dict(r); m.pop("text", None); m.pop("note_id", None)
    for f in ("topics", "terms"):
        try: m[f] = json.loads(m.get(f) or "[]")
        except Exception: m[f] = []
    return m

@bp.get("/notes/<int:nid>/materials")
def list_(nid):
    return jsonify([_row(r) for r in get_db().execute("SELECT id,name,kind,summary,topics,terms,chars,pages,pages_read,created FROM materials WHERE note_id=? ORDER BY id", (nid,))])

@bp.post("/notes/<int:nid>/materials")
def add(nid):
    db = get_db()
    if not db.execute("SELECT 1 FROM notes WHERE id=?", (nid,)).fetchone(): return jsonify(error="Notebook not found."), 404
    f = request.files.get("file"); problems, meta = [], {"pages": 0, "read": 0}
    name = (request.form.get("name") or (f.filename if f else "") or "Pasted text").strip()[:120]
    try:
        if f: text, kind = extract(f.filename or name, (f.mimetype or "").lower(), f.read(), problems, meta)
        else: text, kind = request.form.get("text") or "", "text"      # pasted text
    except ValueError as e: return jsonify(error=str(e)), 400
    except Exception as e: return jsonify(error="The AI couldn't read that file right now: " + str(e)[:160]), 503
    text = re.sub(r"[ \t\f\v]+", " ", re.sub(r"\r\n?", "\n", text or "")); text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(re.sub(r"\[(Page|Slide) \d+\]|\s", "", text)) < 40: return jsonify(error="I couldn't find enough readable text in that. (A scanned PDF reads only its first few pages.)"), 422
    if len(text) > MAX_CHARS: problems.append(f"it's very long, so only the first {MAX_CHARS // 1000}k characters are used"); text = text[:MAX_CHARS]
    sample = text if len(text) <= 14000 else text[:8000] + "\n…\n" + text[len(text) // 2:len(text) // 2 + 3000] + "\n…\n" + text[-3000:]
    summary, topics, terms = "", [], []
    try:
        j = llm.chat_json([{"role": "system", "content": BRIEF}, {"role": "user", "content": f"TITLE: {name}\n\nCOURSE MATERIAL:\n{sample}"}], max_tokens=1500, timeout=(6, 60))
        summary = str(j.get("summary") or "").strip()[:600]
        topics = [str(t).strip()[:60] for t in (j.get("topics") or []) if str(t).strip()][:15]
        terms = [str(t).strip()[:60] for t in (j.get("terms") or []) if str(t).strip()][:40]
    except Exception as e: problems.append("the AI couldn't summarise it right now, but it is still used (" + str(e)[:80] + ")")
    cur = db.execute("INSERT INTO materials(note_id,name,kind,text,summary,topics,terms,chars,pages,pages_read,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                     (nid, name, kind, text, summary, json.dumps(topics), json.dumps(terms), len(text), meta["pages"], meta["read"], now()))
    rag.index("material", cur.lastrowid, text, db); db.commit()
    r = db.execute("SELECT id,name,kind,summary,topics,terms,chars,pages,pages_read,created FROM materials WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify({**_row(r), "problems": problems}), 201

@bp.delete("/materials/<int:mid>")
def delete(mid):
    db = get_db(); db.execute("DELETE FROM materials WHERE id=?", (mid,)); db.execute("DELETE FROM embeddings WHERE kind='material' AND ref_id=?", (mid,)); db.commit()
    return "", 204
