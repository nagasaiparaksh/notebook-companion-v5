"""Accounts. Each person signs up with a username and password and sees only their own notebooks, chats, diagrams and usage numbers.
Login is kept in a signed, http-only session cookie (30 days). Every /api call except the ones in OPEN needs it.
Ownership is checked in one place (_guard): any notebook, chat, diagram or material id in the URL, the JSON body, the form or the
query string must belong to the signed-in account, otherwise the request gets "not found" (other people's ids are never confirmed)."""
import os, re, secrets, time
from datetime import timedelta
from flask import Blueprint, request, jsonify, session, g, has_request_context
from werkzeug.security import generate_password_hash, check_password_hash
import config
import db as dbm
from db import get_db, now
bp = Blueprint("auth", __name__)
USERNAME = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
MIN_PASSWORD = 6
OPEN = {"/api/health", "/api/access", "/api/auth/me", "/api/auth/login", "/api/auth/register", "/api/auth/logout"}

def uid():
    """The signed-in account's id inside a request, else None (background jobs, start-up)."""
    return g.get("uid") if has_request_context() else None

def _secret_key():
    """SECRET_KEY from backend/.env, or one made once and kept next to the database so logins survive a restart."""
    k = config.env("SECRET_KEY")
    if k: return k
    path = os.path.join(os.path.dirname(os.path.abspath(config.DATABASE_PATH)), ".secret_key")
    try:
        with open(path) as f: k = f.read().strip()
    except OSError: k = ""
    if not k:
        k = secrets.token_hex(32)
        try:
            with open(path, "w") as f: f.write(k)
        except OSError: print("  note: couldn't save the session key; everyone will be logged out when the server restarts (set SECRET_KEY in backend/.env)")
    return k

def _user(row): return {"id": row["id"], "username": row["username"]}

def _start(row):
    session.clear(); session.permanent = True; session["uid"] = row["id"]

@bp.get("/auth/me")
def me():
    u = session.get("uid")
    row = get_db().execute("SELECT id,username FROM users WHERE id=? AND username IS NOT NULL", (u,)).fetchone() if u else None
    return jsonify(user=_user(row) if row else None)

@bp.post("/auth/register")
def register():
    d = request.get_json(silent=True) or {}; name = str(d.get("username") or "").strip(); pw = str(d.get("password") or "")
    if not USERNAME.match(name): return jsonify(error="Pick a username of 3 to 32 letters, numbers, dots, dashes or underscores (no spaces)."), 400
    if len(pw) < MIN_PASSWORD: return jsonify(error=f"Use a password of at least {MIN_PASSWORD} characters."), 400
    if len(pw) > 200: return jsonify(error="That password is too long."), 400
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (name,)).fetchone(): return jsonify(error="That username is taken. Try another one."), 409
    first = not db.execute("SELECT 1 FROM users WHERE username IS NOT NULL").fetchone()
    try: cur = db.execute("INSERT INTO users(name,username,pw_hash,created) VALUES(?,?,?,?)", (name, name, generate_password_hash(pw), now()))
    except Exception: return jsonify(error="That username is taken. Try another one."), 409      # two sign-ups racing for the same name
    new_id = cur.lastrowid
    claimed = dbm.claim_unowned(db, new_id) if first else 0
    db.commit()
    if not claimed:                                       # a brand-new account starts with one notebook: "Why use this notebook?"
        import seed
        try: seed.for_user(db, new_id)
        except Exception as e: print("welcome notebook failed:", e)
    row = db.execute("SELECT id,username FROM users WHERE id=?", (new_id,)).fetchone(); _start(row)
    return jsonify(user=_user(row)), 201

@bp.post("/auth/login")
def login():
    d = request.get_json(silent=True) or {}; name = str(d.get("username") or "").strip(); pw = str(d.get("password") or "")
    row = get_db().execute("SELECT id,username,pw_hash FROM users WHERE username=? COLLATE NOCASE", (name,)).fetchone() if name else None
    if not row or not row["pw_hash"] or not check_password_hash(row["pw_hash"], pw):
        time.sleep(0.8)                                   # slows password guessing
        return jsonify(error="That username and password don't match."), 401
    _start(row); return jsonify(user=_user(row))

@bp.post("/auth/logout")
def logout():
    session.clear(); return jsonify(ok=True)

# ----------------------------------------------------------------------- ownership
def owns_note(db, nid, user):
    try: return bool(db.execute("SELECT 1 FROM notes WHERE id=? AND user_id=?", (int(nid), user)).fetchone())
    except (TypeError, ValueError): return False

def _note_ids():
    """Every notebook id this request names outside the URL path."""
    out = [request.args.get("note_id")]
    j = request.get_json(silent=True) if request.is_json else None
    if isinstance(j, dict):
        out.append(j.get("note_id"))
        if isinstance(j.get("context"), dict): out.append(j["context"].get("note_id"))     # /voice/interpret sends it inside "context"
    elif request.mimetype in ("multipart/form-data", "application/x-www-form-urlencoded"): out.append(request.form.get("note_id"))
    return [x for x in out if x not in (None, "")]

def _guard():
    db, user, va = get_db(), g.uid, request.view_args or {}
    gone = lambda what: (jsonify(error=f"{what} not found."), 404)
    if "nid" in va and not owns_note(db, va["nid"], user): return gone("Notebook")
    if "sid" in va and not db.execute("SELECT 1 FROM sessions WHERE id=? AND user_id=?", (va["sid"], user)).fetchone(): return gone("Chat")
    if "did" in va and not db.execute("SELECT 1 FROM diagrams WHERE id=? AND user_id=?", (va["did"], user)).fetchone(): return gone("Diagram")
    if "mid" in va and not db.execute("SELECT 1 FROM materials m JOIN notes n ON n.id=m.note_id WHERE m.id=? AND n.user_id=?", (va["mid"], user)).fetchone(): return gone("Material")
    for nid in _note_ids():
        if not owns_note(db, nid, user): return gone("Notebook")
    return None

def install(app):
    app.secret_key = _secret_key()
    app.config.update(SESSION_COOKIE_NAME="nc_session", SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=os.getenv("TRUST_PROXY") == "1", PERMANENT_SESSION_LIFETIME=timedelta(days=30))
    app.register_blueprint(bp, url_prefix="/api")
    @app.before_request
    def _gate():
        p = request.path
        if not p.startswith("/api/") or p in OPEN: return None
        u = session.get("uid")
        row = get_db().execute("SELECT id,username FROM users WHERE id=? AND username IS NOT NULL", (u,)).fetchone() if u else None
        if not row: return jsonify(error="Please log in.", auth=True), 401
        g.uid, g.username = row["id"], row["username"]
        return _guard()
