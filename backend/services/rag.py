import json, re, hashlib, numpy as np
import config
from db import standalone
from services import llm
DIM = 1024
def _local(text):
    v = np.zeros(DIM, dtype=np.float32)
    for w in re.findall(r"\w+", text.lower(), re.U):
        if len(w) > 2: v[int(hashlib.md5(w.encode()).hexdigest(), 16) % DIM] += 1
    n = np.linalg.norm(v); return (v / n).tolist() if n else v.tolist()
def provider(): return "remote:" + config.EMBED_MODEL if (config.EMBED_BASE_URL and config.EMBED_MODEL) else "local"
def embed(texts):
    return llm.embed_remote(texts) if provider() != "local" else [_local(t) for t in texts]
def chunk(text, size=700):
    text = re.sub(r"<[^>]+>", " ", text or ""); text = re.sub(r"\s+", " ", text).strip()
    if not text: return []
    out, cur = [], ""
    for s in re.split(r"(?<=[.!?।])\s+", text):
        if len(cur) + len(s) > size and cur: out.append(cur); cur = ""
        cur += (" " if cur else "") + s
    return out + ([cur] if cur else [])
def index(kind, ref_id, text, db=None):
    own = db is None; db = db or standalone()
    db.execute("DELETE FROM embeddings WHERE kind=? AND ref_id=?", (kind, ref_id))
    cs = chunk(text)
    if cs:
        for c, v in zip(cs, embed(cs)):
            db.execute("INSERT INTO embeddings(kind,ref_id,chunk,provider,vec) VALUES(?,?,?,?,?)", (kind, ref_id, c, provider(), json.dumps(v)))
    if own: db.commit(); db.close()
OWNED_BY = {"note": "SELECT id FROM notes WHERE user_id=?",
            "chat": "SELECT m.id FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.user_id=?"}
def search(query, kind="note", k=5, db=None, exclude=None, uid=None):
    """Only the given account's notes / chats (uid, else the signed-in account of the current request)."""
    if uid is None:
        from auth import uid as _current; uid = _current()
    sql, args = "SELECT ref_id,chunk,vec FROM embeddings WHERE kind=? AND provider=?", [kind, provider()]
    if kind in OWNED_BY:
        if uid is None: return []                         # never search across accounts
        sql += f" AND ref_id IN ({OWNED_BY[kind]})"; args.append(uid)
    own = db is None; db = db or standalone()
    rows = db.execute(sql, args).fetchall()
    if own: db.close()
    rows = [r for r in rows if r["ref_id"] != exclude]
    if not rows: return []
    q = np.array(embed([query])[0], dtype=np.float32)
    M = np.array([json.loads(r["vec"]) for r in rows], dtype=np.float32)
    sims = M @ q / (np.linalg.norm(M, axis=1) * (np.linalg.norm(q) or 1) + 1e-9)
    best = {}
    for i in np.argsort(-sims):
        rid = rows[i]["ref_id"]
        if rid not in best: best[rid] = {"ref_id": rid, "chunk": rows[i]["chunk"], "score": float(sims[i])}
        if len(best) >= k: break
    return list(best.values())
def search_chunks(query, kind, ref_ids, k=6, db=None):
    """Top-k chunks (several may come from the same document), limited to the given ref_ids. Used for course material."""
    ref_ids = [int(r) for r in ref_ids or []]
    if not ref_ids or not (query or "").strip(): return []
    own = db is None; db = db or standalone()
    rows = db.execute(f"SELECT ref_id,chunk,vec FROM embeddings WHERE kind=? AND provider=? AND ref_id IN ({','.join('?' * len(ref_ids))})", (kind, provider(), *ref_ids)).fetchall()
    if own: db.close()
    if not rows: return []
    q = np.array(embed([query])[0], dtype=np.float32)
    M = np.array([json.loads(r["vec"]) for r in rows], dtype=np.float32)
    sims = M @ q / (np.linalg.norm(M, axis=1) * (np.linalg.norm(q) or 1) + 1e-9)
    return [{"ref_id": rows[i]["ref_id"], "chunk": rows[i]["chunk"], "score": float(sims[i])} for i in np.argsort(-sims)[:k] if sims[i] > 0.02]
def reindex_all(uid=None):
    db = standalone()
    rows = db.execute("SELECT id,title,content,summary_detailed FROM notes" + (" WHERE user_id=?" if uid is not None else ""), (() if uid is None else (uid,))).fetchall()
    for n in rows:
        index("note", n["id"], f"{n['title']}. {n['content']} {n['summary_detailed']}", db)
    db.commit(); db.close()
