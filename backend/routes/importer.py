"""Import a photo / scan / PDF of notes into sheets, using Gemini's vision to read handwriting and print."""
import base64, re, html
from html.parser import HTMLParser
from flask import Blueprint, request, jsonify
from services import llm
bp = Blueprint("importer", __name__)
MAX_PAGES = 12

OCR_PROMPT = """You are a careful note-taker digitising a photo or scan of a student's notes (handwritten or printed).
Transcribe EVERYTHING you can read into clean HTML, using only these tags: <h2> (titles and headings), <p>, <ul>/<ol>/<li>, <b>, <i>.
Keep the original language, wording and order. Join lines that were only wrapped by the page edge. Do not add explanations, corrections or anything that is not on the page.
Use [?] for a word you cannot read. For a diagram, figure or picture write <p><i>[Diagram: one short description, including its labels]</i></p>. For a table write one <li> per row with cells separated by " — ".
Return ONLY the HTML, with no markdown fences and no commentary. If the page has no readable writing, return exactly: EMPTY"""

class _Clean(HTMLParser):
    OK = {"h2", "p", "ul", "ol", "li", "b", "i", "br"}
    def __init__(self): super().__init__(convert_charrefs=True); self.out = []
    def handle_starttag(self, t, a):
        t = {"h1": "h2", "h3": "h2", "h4": "h2", "strong": "b", "em": "i"}.get(t, t)
        if t in self.OK: self.out.append(f"<{t}>" if t != "br" else "<br>")
    def handle_endtag(self, t):
        t = {"h1": "h2", "h3": "h2", "h4": "h2", "strong": "b", "em": "i"}.get(t, t)
        if t in self.OK and t != "br": self.out.append(f"</{t}>")
    def handle_data(self, d): self.out.append(html.escape(d, quote=False))

def clean_html(raw):
    raw = re.sub(r"^```(?:html)?|```$", "", (raw or "").strip(), flags=re.M).strip()
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw, flags=re.S | re.I)
    if not raw or raw.upper() == "EMPTY": return ""
    p = _Clean(); p.feed(raw); out = "".join(p.out).strip()
    if not re.search(r"<(h2|p|ul|ol|li)\b", out): out = "".join(f"<p>{l}</p>" for l in re.split(r"\n+", out) if l.strip())
    return out if re.sub(r"<[^>]+>", "", out).strip() else ""

@bp.post("/import/page")
def page():
    d = request.json or {}; img = d.get("image") or ""
    if not re.match(r"^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$", img) or len(img) > 14_000_000: return jsonify(error="That image couldn't be read. Use a JPG, PNG or WebP photo."), 400
    try:
        out = llm.chat([{"role": "user", "content": [{"type": "text", "text": OCR_PROMPT}, {"type": "image_url", "image_url": {"url": img}}]}], temperature=0.1, max_tokens=6000, timeout=(8, 110))
    except Exception as e: return jsonify(error="The AI couldn't read that page: " + str(e)[:200]), 503
    h = clean_html(out)
    if not h: return jsonify(error="I couldn't find any readable writing on that page. Try a sharper, well-lit, straight-on photo."), 422
    return jsonify({"html": h})

def _text_to_html(t):
    paras = [re.sub(r"\s*\n\s*", " ", p).strip() for p in re.split(r"\n\s*\n", t.strip())]
    return "".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paras if p)

@bp.post("/import/pdf")
def pdf():
    f = request.files.get("file")
    if not f: return jsonify(error="No file."), 400
    try:
        try: import pymupdf as fitz
        except ImportError: import fitz
    except ImportError: return jsonify(error="PDF import needs one extra package. Run: pip install pymupdf  (then restart Flask)."), 501
    try: doc = fitz.open(stream=f.read(), filetype="pdf")
    except Exception: return jsonify(error="That PDF couldn't be opened (is it password-protected or damaged?)."), 400
    pages = []
    for i, pg in enumerate(doc):
        if i >= MAX_PAGES: break
        text = (pg.get_text() or "").strip()
        if len(text) >= 150: pages.append({"n": i + 1, "kind": "text", "html": _text_to_html(text)}); continue
        pix = pg.get_pixmap(dpi=150)
        pages.append({"n": i + 1, "kind": "image", "image": "data:image/jpeg;base64," + base64.b64encode(pix.tobytes("jpeg")).decode()})
    return jsonify({"pages": pages, "total": len(doc), "truncated": len(doc) > MAX_PAGES})
