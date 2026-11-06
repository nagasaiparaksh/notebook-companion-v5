import json
from flask import Blueprint, request, jsonify, g
from db import get_db, now
from services import llm, layout
bp = Blueprint("diagrams", __name__)
GEN = """Return ONLY compact JSON for a labelled diagram graph, no prose:
{{"title":str,"layout":"flow"|"radial","nodes":[{{"id":str,"label":str(<=4 words),"kind":"rect"|"ellipse"|"diamond"}}],"edges":[{{"from":id,"to":id,"label":str(<=3 words or "")}}]}}
"radial" = mind/concept map (first node is the centre); "flow" otherwise. Category: {cat}. 6-14 nodes max. Be accurate, include every part the user lists, in order. diamond only for decisions."""

def _g(title, nodes, edges, lay="flow"):
    return {"title": title, "layout": lay, "fallback": True,
            "nodes": [{"id": a, "label": b, "kind": c} for a, b, c in nodes], "edges": [{"from": a, "to": b, "label": l} for a, b, l in edges]}

# Offline templates: used instantly when the AI provider is down. keywords -> graph
TEMPLATES = [
    (("recurrent neural network", "rnn"), _g("Recurrent Neural Network (RNN)", [("x","Input xt","rect"),("m","Previous state ht-1","rect"),("c","RNN cell","ellipse"),("h","Hidden state ht","rect"),("y","Output yt","rect")],
        [("x","c","current input"),("m","c","memory"),("c","h","updated state"),("h","y","prediction")])),
    (("convolutional neural network", "cnn"), _g("CNN architecture", [("i","Input image","rect"),("c","Convolution","rect"),("r","ReLU","ellipse"),("p","Pooling","rect"),("f","Flatten","rect"),("d","Fully connected","rect"),("o","Output","ellipse")],
        [("i","c",""),("c","r",""),("r","p",""),("p","f",""),("f","d",""),("d","o","")])),
    (("transformer", "self-attention", "attention mechanism"), _g("Transformer", [("t","Input tokens","rect"),("e","Embeddings + position","rect"),("a","Self-attention","ellipse"),("n","Add & normalise","rect"),("f","Feed-forward","rect"),("o","Output","ellipse")],
        [("t","e",""),("e","a",""),("a","n",""),("n","f",""),("f","o","")])),
    (("photosynthesis",), _g("Photosynthesis", [("sun","Sunlight","ellipse"),("w","Water","rect"),("co","Carbon dioxide","rect"),("pl","Chloroplast","ellipse"),("g","Glucose","rect"),("o","Oxygen","rect")],
        [("sun","pl","energy"),("w","pl","input"),("co","pl","input"),("pl","g","produces"),("pl","o","releases")])),
    (("binary search",), _g("Binary Search", [("a","Sorted array","rect"),("m","Check middle","diamond"),("l","Search left half","rect"),("r","Search right half","rect"),("f","Target found","ellipse")],
        [("a","m","midpoint"),("m","l","target smaller"),("m","r","target larger"),("m","f","equal")])),
    (("water cycle",), _g("Water cycle", [("o","Oceans & lakes","rect"),("e","Evaporation","ellipse"),("c","Condensation","ellipse"),("cl","Clouds","rect"),("p","Precipitation","ellipse"),("r","Runoff","rect")],
        [("o","e","sun heats"),("e","c","vapour rises"),("c","cl",""),("cl","p",""),("p","r",""),("r","o","flows back")])),
    (("gradient descent", "backpropagation"), _g("Gradient descent", [("w","Initial weights","rect"),("f","Forward pass","rect"),("l","Compute loss","rect"),("g","Compute gradients","rect"),("u","Update weights","rect"),("d","Converged?","diamond")],
        [("w","f",""),("f","l",""),("l","g","backprop"),("g","u",""),("u","d",""),("d","f","no")])),
    (("amoeba",), _g("Amoeba", [("c","Amoeba cell","ellipse"),("n","Nucleus","rect"),("p","Pseudopodia","rect"),("v","Contractile vacuole","rect"),("f","Food vacuole","rect"),("m","Cell membrane","rect")],
        [("c","n","controls"),("c","p","movement"),("c","v","water balance"),("c","f","digestion"),("c","m","boundary")], "radial")),
]
def _offline_graph(prompt: str):
    p = prompt.lower()
    for keys, g in TEMPLATES:
        if any(k in p for k in keys): return g
    return None

_cache = {}  # normalized prompt -> graph; repeated requests are instant
def _key(prompt, cat): return " ".join(prompt.lower().split())[:600] + "|" + (cat or "")

@bp.post("/diagrams/generate")
def generate():
    d = request.json or {}; prompt = (d.get("prompt") or "").strip()
    if not prompt: return jsonify(error="Describe the diagram you want"), 400
    prompt = prompt[:1800]; cat = d.get("category", "any"); k = _key(prompt, cat)
    g = _cache.get(k)
    if g is None:
        try:
            g = llm.chat_json([{"role": "system", "content": GEN.format(cat=cat)}, {"role": "user", "content": prompt}], max_tokens=1100, timeout=(6, 35))
            if len(_cache) > 100: _cache.pop(next(iter(_cache)))
            if g.get("nodes"): _cache[k] = g
        except llm.NotConfigured:
            g = _offline_graph(prompt)
            if not g: raise
        except Exception as exc:
            g = _offline_graph(prompt)
            if not g:
                return jsonify(error=f"The AI service is busy right now. Your note is safe - try again in a few seconds. ({str(exc)[:140]})"), 503
    data = layout.build(g.get("nodes", []), g.get("edges", []), g.get("layout", "flow"))
    if not data["elements"]: _cache.pop(k, None); return jsonify(error="The model returned an empty diagram. Try rephrasing."), 502
    return jsonify(title=g.get("title", "Diagram"), data=data, fallback=bool(g.get("fallback", False)))
@bp.get("/diagrams")
def list_():
    return jsonify([{k: r[k] for k in ("id", "title", "svg", "updated")} for r in get_db().execute("SELECT * FROM diagrams WHERE user_id=? ORDER BY updated DESC", (g.uid,))])
@bp.post("/diagrams")
def create():
    d = request.json or {}; db = get_db(); t = now()
    cur = db.execute("INSERT INTO diagrams(title,data,svg,created,updated,user_id) VALUES(?,?,?,?,?,?)", (d.get("title", "Untitled diagram"), json.dumps(d.get("data", {})), d.get("svg", ""), t, t, g.uid))
    db.commit(); return jsonify(id=cur.lastrowid), 201
@bp.get("/diagrams/<int:did>")
def get(did):
    r = get_db().execute("SELECT * FROM diagrams WHERE id=?", (did,)).fetchone()
    if not r: return jsonify(error="Diagram not found"), 404
    x = dict(r); x["data"] = json.loads(x["data"]); return jsonify(x)
@bp.put("/diagrams/<int:did>")
def update(did):
    d = request.json or {}; db = get_db()
    db.execute("UPDATE diagrams SET title=?,data=?,svg=?,updated=? WHERE id=?", (d.get("title", "Untitled diagram"), json.dumps(d.get("data", {})), d.get("svg", ""), now(), did)); db.commit()
    return jsonify(id=did)
@bp.delete("/diagrams/<int:did>")
def delete(did):
    db = get_db(); db.execute("DELETE FROM diagrams WHERE id=?", (did,)); db.commit(); return "", 204
