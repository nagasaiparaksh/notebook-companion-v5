"""Turns LLM nodes/edges into editable diagram JSON (the same schema the Konva editor uses)."""
import math, uuid
PALETTE = ["#FFF3A3", "#C9F2DD", "#FFD0C2", "#D9D2FF", "#BFD4FF", "#FFE0C7"]
def _id(): return uuid.uuid4().hex[:8]
def build(nodes, edges, layout="flow"):
    nodes = [n for n in nodes if n.get("id") and n.get("label")][:30]
    ids = {n["id"] for n in nodes}
    edges = [e for e in edges if e.get("from") in ids and e.get("to") in ids]
    level = {n["id"]: 0 for n in nodes}
    for _ in range(len(nodes)):  # longest-path layering, cycle-safe
        for e in edges:
            if level[e["to"]] < level[e["from"]] + 1 and level[e["from"]] + 1 < len(nodes): level[e["to"]] = level[e["from"]] + 1
    W, H, GX, GY = 190, 80, 70, 90
    pos = {}
    if layout == "radial" and nodes:
        root = nodes[0]["id"]; pos[root] = (0, 0); others = [n["id"] for n in nodes[1:]]
        for i, nid in enumerate(others):
            a = 2 * math.pi * i / max(1, len(others)); pos[nid] = (math.cos(a) * 330, math.sin(a) * 250)
    else:
        rows = {}
        for n in nodes: rows.setdefault(level[n["id"]], []).append(n["id"])
        for lv, row in rows.items():
            for i, nid in enumerate(row): pos[nid] = ((i - (len(row) - 1) / 2) * (W + GX), lv * (H + GY))
    els, eid = [], {}
    kinds = {"ellipse", "rect", "diamond"}
    for i, n in enumerate(nodes):
        x, y = pos[n["id"]]; k = n.get("kind") if n.get("kind") in kinds else "rect"
        e = {"id": _id(), "type": k, "x": x + 450 - W / 2, "y": y + 300 - H / 2 if layout == "radial" else y + 60, "w": W, "h": H, "rotation": 0,
             "text": n["label"], "fontSize": 20, "fill": n.get("color") or PALETTE[i % len(PALETTE)], "stroke": "#2B2B2B", "strokeWidth": 2.5, "seed": i + 3, "group": None}
        eid[n["id"]] = e["id"]; els.append(e)
    for e in edges:
        els.append({"id": _id(), "type": "arrow", "from": eid[e["from"]], "to": eid[e["to"]], "text": e.get("label", ""), "fontSize": 16,
                    "stroke": "#3B5BDB", "strokeWidth": 2.5, "seed": 7, "group": None, "x": 0, "y": 0, "w": 0, "h": 0, "rotation": 0, "fill": "none"})
    return {"version": 1, "elements": els}
