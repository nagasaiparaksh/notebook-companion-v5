"""Napkin-style text -> visual. The model returns a small structured spec (what the text *means*); the browser then renders the
same spec in several layouts/themes so the person can pick, exactly like choosing between Napkin's suggestions."""
import re, hashlib
from flask import Blueprint, request, jsonify
from services import llm, topics
import concurrent.futures as _cf
bp = Blueprint("visuals", __name__)
KINDS = ["process", "cycle", "hierarchy", "mindmap", "comparison", "timeline", "list"]
PROMPT = """You turn a passage of text into a structured spec for an infographic (like Napkin AI). Return ONLY JSON:
{"title":str(<=6 words),"kinds":[best-fit layouts, best first, 3 to 5 of: "process","cycle","hierarchy","mindmap","comparison","timeline","list"],
 "nodes":[{"id":str,"label":str(<=5 words),"detail":str(<=14 words, optional, from the text),"icon":one emoji that fits the idea,"group":str(only for comparison: the side/column name),"parent":id(only for hierarchy/mindmap; the first node is the root)}]}
Rules: {facts} 3 to 10 nodes in the order the text presents them. Labels are short noun/verb phrases, not sentences.
Layout guide: process = ordered steps; cycle = repeating loop; hierarchy = parent/child or categories; mindmap = one central idea with branches; comparison = two or more sides (give each node a group); timeline = dated/sequential events; list = parallel items.
Write labels in the same language as the text. {hint}"""

def _clean(spec):
    nodes, seen = [], set()
    for i, n in enumerate(spec.get("nodes") or []):
        if not isinstance(n, dict) or not str(n.get("label", "")).strip(): continue
        nid = str(n.get("id") or f"n{i}")
        if nid in seen: nid = f"{nid}_{i}"
        seen.add(nid)
        icon = str(n.get("icon") or "").strip()
        nodes.append({"id": nid, "label": str(n["label"]).strip()[:48], "detail": str(n.get("detail") or "").strip()[:110],
                      "icon": icon[:4] if icon and not icon.isascii() else "", "group": str(n.get("group") or "").strip()[:30],
                      "parent": str(n["parent"]) if n.get("parent") else ""})
    nodes = nodes[:12]
    ids = {n["id"] for n in nodes}
    for n in nodes:
        if n["parent"] not in ids: n["parent"] = ""
    kinds = [k for k in (spec.get("kinds") or []) if k in KINDS]
    for k in ("process", "list", "mindmap"):
        if k not in kinds: kinds.append(k)
    return {"title": str(spec.get("title") or "Visual").strip()[:60], "kinds": kinds, "nodes": nodes}

def _heuristic(text):
    """Used only when the AI is unreachable: split the text into items so the person still gets a usable layout."""
    t = re.sub(r"\s+", " ", text.replace("\n", ". ")).strip()
    parts = [p.strip(" -•*\t") for p in re.split(r"(?<=[.!?;:])\s+|\n|\s[-•]\s|\d+[.)]\s", text.replace("\r", "")) if p and p.strip(" -•*\t.")]
    parts = [re.sub(r"\s+", " ", p).strip(" .") for p in parts if len(p.strip()) > 2][:10] or [t[:80]]
    nodes = []
    for i, p in enumerate(parts):
        words = p.split()
        nodes.append({"id": f"n{i}", "label": " ".join(words[:5]), "detail": " ".join(words[5:19]), "icon": "", "group": "", "parent": ""})
    low = text.lower()
    seq = bool(re.search(r"\b(first|then|next|finally|step|after that|lastly)\b", low)) or bool(re.search(r"^\s*\d+[.)]", text, re.M))
    kinds = (["process", "timeline", "list", "mindmap"] if seq else ["list", "mindmap", "process", "hierarchy"])
    return {"title": " ".join(parts[0].split()[:5]) or "Visual", "kinds": kinds, "nodes": nodes}

_cache = {}
TOPIC_RULE = "the text is only a TOPIC NAME: use your own accurate knowledge to lay out its main parts, stages or relationships (a labelled-diagram style breakdown). Do not invent facts."
TEXT_RULE = "use ONLY facts in the text, never invent."
@bp.post("/visuals/generate")
def generate():
    d = request.json or {}; text = (d.get("text") or "").strip()
    if len(text) < 3: return jsonify(error="Select or say something to turn into a visual."), 400
    text = text[:4000]; hint = d.get("hint") or ""; topic = bool(d.get("topic"))
    key = hashlib.md5((text + "|" + hint + str(topic)).encode()).hexdigest()
    if key in _cache: return jsonify(_cache[key])
    def ask():
        return _clean(llm.chat_json([{"role": "system", "content": PROMPT.replace("{facts}", TOPIC_RULE if topic else TEXT_RULE).replace("{hint}", f"The person asked for a {hint} layout if it fits." if hint in KINDS else "")},
                                     {"role": "user", "content": text}], max_tokens=1400, timeout=(5, 25)))
    def finish(spec, fallback, **extra):
        if hint in KINDS: spec["kinds"] = [hint] + [k for k in spec["kinds"] if k != hint]
        return {"spec": spec, "fallback": fallback, **extra}
    lib = topics.find(text) if (topic or len(text) <= 80) else None
    if lib:                                    # known study topic: instant, no AI wait
        out = finish(lib, False, builtin=True); _cache[key] = out; return jsonify(out)
    ex = _cf.ThreadPoolExecutor(max_workers=1); fut = ex.submit(ask)
    try:
        spec = fut.result(timeout=32)          # stay well inside the browser's 50 s limit
        if len(spec["nodes"]) < 2: raise RuntimeError("The model returned too little structure.")
        out = finish(spec, False); _cache[key] = out
        if len(_cache) > 80: _cache.pop(next(iter(_cache)))
        return jsonify(out)
    except Exception as e:
        err = str(e) or "the AI took too long"
        lib = topics.find(text)
        if lib: return jsonify(finish(lib, True, builtin=True, ai_error=err[:300]))
        if topic: return jsonify(error="The AI is slow or not answering right now, and I have no built-in diagram for this topic. Try again in a moment. (" + err[:140] + ")"), 503
        return jsonify(finish(_clean(_heuristic(text)), True, ai_error=err[:300]))
    finally:
        ex.shutdown(wait=False)


# ---------------------------------------------------------------- labelled diagrams (e.g. "the heart")
import xml.etree.ElementTree as ET
from services import figures
_SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", _SVG)
_TAGS = {"g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "lineargradient", "radialgradient", "stop"}
_ATTRS = {"d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "fill", "stroke", "stroke-width", "stroke-linecap",
          "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "transform", "offset", "stop-color", "stop-opacity", "id",
          "gradientunits", "gradienttransform", "fx", "fy", "fill-rule", "clip-rule"}
_BAD = re.compile(r"javascript|data:|http|<|expression|@import|url\(\s*(?!#)", re.I)

def _clean_svg(markup):
    """Keep only plain drawing primitives so a model-written (or tampered) SVG can never carry script, images, links or external refs."""
    markup = re.sub(r"<\?xml.*?\?>|<!DOCTYPE[^>]*>|<!--.*?-->", "", str(markup or ""), flags=re.S)
    markup = re.sub(r"</?svg[^>]*>", "", markup, flags=re.I)
    try: root = ET.fromstring(f'<svg xmlns="{_SVG}">{markup}</svg>')
    except ET.ParseError: raise ValueError("The drawing the model returned was not valid SVG.")
    count = [0]
    def walk(el):
        for ch in list(el):
            tag = ch.tag.split("}")[-1].lower()
            if tag not in _TAGS: el.remove(ch); continue
            count[0] += 1
            for k in list(ch.attrib):
                kk = k.split("}")[-1].lower(); v = ch.attrib[k]
                if kk not in _ATTRS or _BAD.search(v) or len(v) > 4000: del ch.attrib[k]
            walk(ch)
    walk(root)
    if count[0] < 3: raise ValueError("The model's drawing was too empty to use.")
    out = "".join(ET.tostring(c, encoding="unicode") for c in root).replace(f' xmlns="{_SVG}"', "")
    return out[:20000]

LAB_PROMPT = """You are a scientific illustrator who draws in SVG. Draw ONE simple, clean, recognisable educational illustration of the subject for a labelled diagram, then list its parts.
Return ONLY JSON: {"title":str(<=6 words),"drawing":str,"parts":[{"label":str(<=3 words),"detail":str(<=12 words, what it is/does),"x":number,"y":number}]}
"drawing" = SVG elements ONLY (no <svg> wrapper, no text, no images, no scripts) in a 400x400 coordinate space. Allowed: g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop.
Style: flat pastel fills, dark outlines (stroke="#2B2B2B" stroke-width="3" stroke-linejoin="round"), the subject large and centred, filling about x 40..360 and y 30..370. Draw each labelled part as its own clearly separate, differently coloured shape. Order shapes back-to-front.
"parts": 5 to 10 parts. Each (x,y) MUST lie inside (or on the edge of) that part's shape in YOUR drawing, and anchors must be at least 40 units apart. Use accurate names. {src}
Write labels and details in the same language as the subject."""

@bp.post("/visuals/labelled")
def labelled():
    d = request.json or {}; subject = (d.get("subject") or "").strip()[:200]; text = (d.get("text") or "").strip()[:3000]
    if not subject and not text: return jsonify(error="Say or select what to draw a labelled diagram of."), 400
    fig = figures.find(subject) or (figures.find(text) if not subject and len(text) <= 40 else None)
    if fig: return jsonify({"figure": figures.as_dict(fig)})
    key = hashlib.md5(("lab|" + subject + "|" + text).encode()).hexdigest()
    if key in _cache: return jsonify(_cache[key])
    src = f'SUBJECT: "{subject}".' if subject else "Work out the single thing this passage is about, draw THAT, and prefer the parts the passage mentions:\n" + text
    if subject and text: src += "\nContext from the notes (prefer parts mentioned here):\n" + text
    try:
        j = llm.chat_json([{"role": "system", "content": LAB_PROMPT.replace("{src}", src)}, {"role": "user", "content": subject or text[:200]}], max_tokens=6000, timeout=(6, 75))
        drawing = _clean_svg(j.get("drawing"))
        parts = []
        for p in j.get("parts") or []:
            try: x, y = float(p["x"]), float(p["y"])
            except Exception: continue
            lab = str(p.get("label") or "").strip()
            if lab: parts.append({"label": lab[:32], "detail": str(p.get("detail") or "").strip()[:100], "x": max(0, min(400, x)), "y": max(0, min(400, y))})
        parts = parts[:10]
        if len(parts) < 3: raise ValueError("The model named too few parts.")
        out = {"figure": {"id": "ai", "title": str(j.get("title") or subject or "Diagram").strip()[:60], "drawing": drawing, "parts": parts, "source": "ai"}}
        _cache[key] = out
        if len(_cache) > 80: _cache.pop(next(iter(_cache)))
        return jsonify(out)
    except Exception as e:
        return jsonify(error="I couldn't draw that one. The AI drawing step failed (" + str(e)[:160] + "). Try again, or ask for the heart, an animal cell or a flower, which are built in."), 503
