"""Helpers for multi-sheet notes. A sheet = {id, html, objects:[{id, kind, src, alt, x, y, w, h}]}."""
import re, json, html as _html, uuid

def _id(): return uuid.uuid4().hex[:8]

def plain_text(h):
    h = re.sub(r"<img[^>]*?alt=\"([^\"]*)\"[^>]*>", r" [Image: \1] ", h or "", flags=re.I)
    h = re.sub(r"</(p|div|h[1-6]|li|tr)>|<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    h = _html.unescape(h)
    h = re.sub(r"[ \t\f\v ]+", " ", h)
    return re.sub(r"\s*\n\s*", "\n", h).strip()

def normalize(sheets, legacy_html=""):
    out = []
    for s in (sheets or []):
        if not isinstance(s, dict): continue
        objs = []
        for o in s.get("objects") or []:
            if not isinstance(o, dict) or not str(o.get("src", "")).startswith(("data:image/", "http")): continue
            objs.append({"id": str(o.get("id") or _id()), "kind": o.get("kind") if o.get("kind") in ("image", "visual") else "image",
                         "src": o["src"], "alt": str(o.get("alt", ""))[:300], "x": float(o.get("x", 0) or 0), "y": float(o.get("y", 0) or 0),
                         "w": max(20.0, float(o.get("w", 300) or 300)), "h": max(20.0, float(o.get("h", 200) or 200)),
                         "meta": o["meta"] if isinstance(o.get("meta"), dict) and len(json.dumps(o["meta"])) < 30000 else None, "manual": bool(o.get("manual"))})
        out.append({"id": str(s.get("id") or _id()), "html": str(s.get("html") or ""), "objects": objs})
    return out or [{"id": _id(), "html": legacy_html or "", "objects": []}]

def sheet_plain(s):
    lines = [plain_text(s.get("html", ""))]
    for o in s.get("objects", []):
        if o.get("alt"): lines.append(f"[{'Visual' if o.get('kind') == 'visual' else 'Image'} on this sheet: {o['alt']}]")
    return "\n".join(l for l in lines if l).strip()

def content_from(sheets):
    """Flat HTML of all sheets, used for search/indexing and as the legacy `content` field."""
    parts = []
    for i, s in enumerate(sheets, 1):
        extra = "".join(f"<p>[{'Visual' if o.get('kind') == 'visual' else 'Image'}: {_html.escape(o.get('alt', ''))}]</p>" for o in s.get("objects", []) if o.get("alt"))
        parts.append(f"<section data-sheet=\"{i}\">{s.get('html', '')}{extra}</section>")
    return "\n".join(parts)

def notebook_text(sheets, limit=24000):
    """Plain text of the whole note, labelled per sheet, trimmed fairly across sheets."""
    texts = [sheet_plain(s) for s in sheets]
    total = sum(len(t) for t in texts) or 1
    out = []
    for i, t in enumerate(texts, 1):
        cap = max(600, int(limit * len(t) / total)) if total > limit else len(t)
        out.append(f"=== Sheet {i} of {len(texts)} ===\n{t[:cap] or '(empty)'}")
    return "\n\n".join(out)
