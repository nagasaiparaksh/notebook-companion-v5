import logging, os
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import db as dbm
import auth
from services.llm import NotConfigured
from services.gnani import GnaniError
from routes import notes, chat, diagrams, misc, visuals, voice, study, importer, materials, library, speech
from services import backup
try: from flask_sock import Sock                       # live lecture captions; the app must still start without it
except ImportError: Sock = None
logging.basicConfig(level=logging.INFO)
def create_app():
    app = Flask(__name__); app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024; CORS(app); dbm.init_db(); app.teardown_appcontext(dbm.close_db)
    backup.snapshot()                                   # a fresh backup on start-up if the last one is older than 6 hours
    if os.getenv("TRUST_PROXY") == "1":                 # behind a hosting proxy (Render, Railway…): real https / host for cookies
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    _access_gate(app)
    auth.install(app)                                   # username + password accounts; each person sees only their own notebooks
    for m in (notes, chat, diagrams, misc, visuals, voice, study, importer, materials, library, speech): app.register_blueprint(m.bp, url_prefix="/api")
    mock = os.getenv("NC_MOCK") == "1"
    if mock: from services import mock as _m; _m.install(app)     # end-to-end tests only: no network, no credits
    if Sock: (_m.register_ws if mock else speech.register_ws)(Sock(app))   # live lecture captions: WebSocket relay to Gnani's realtime STT
    else: print("  note: live lecture captions are off (run: pip install -r requirements.txt). Lecture mode uses ~25 s pieces instead.")
    @app.errorhandler(NotConfigured)
    def _nc(e): return jsonify(error=str(e), setup=True), 503
    @app.errorhandler(GnaniError)
    def _g(e): return jsonify(error=str(e), setup="API key" in str(e)), 502
    @app.errorhandler(Exception)
    def _e(e):
        app.logger.exception("unhandled"); return jsonify(error=str(e)), 500
    dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
    @app.route("/", defaults={"p": ""})
    @app.route("/<path:p>")
    def _spa(p):  # serves the built frontend, so http://localhost:5000 shows the app without Vite
        if p.startswith("api/"): return jsonify(error="Not found"), 404
        if p and os.path.isfile(os.path.join(dist, p)): return send_from_directory(dist, p)
        if os.path.isfile(os.path.join(dist, "index.html")): return send_from_directory(dist, "index.html")
        return "Frontend not built. Run: cd frontend && npm install && npm run build  (or npm run dev and open :5173)", 404
    return app
def _access_gate(app):
    """Online, the app must not be open to anyone with the link (they would read every notebook and spend your AI / Gnani
    credits). Set APP_ACCESS_CODE and every /api call (and the live-caption WebSocket) needs it; it is remembered in a cookie."""
    from flask import request
    import hmac, hashlib, time as _t
    code = os.getenv("APP_ACCESS_CODE", "").strip()
    @app.get("/api/health")
    def _health(): return jsonify(ok=True)              # for the host's health check; reveals nothing
    if not code: return
    token = hmac.new(code.encode(), b"notebook-companion-access", hashlib.sha256).hexdigest()
    @app.before_request
    def _gate():
        p = request.path
        if not p.startswith("/api/") or p in ("/api/health", "/api/access"): return None
        if hmac.compare_digest(request.cookies.get("nc_access", ""), token): return None
        return jsonify(error="Enter the access code to use this notebook.", access=True), 401
    @app.post("/api/access")
    def _access():
        given = str((request.json or {}).get("code") or "").strip()
        if not hmac.compare_digest(given.encode(), code.encode()): _t.sleep(1.0); return jsonify(error="That code isn't right."), 403   # slows guessing
        r = jsonify(ok=True); r.set_cookie("nc_access", token, max_age=90 * 24 * 3600, httponly=True, samesite="Lax", secure=request.is_secure); return r
    print("  access code required (APP_ACCESS_CODE is set)")

def _free_port(start):
    """Port 5000 is often taken on Windows (Docker / WSL relay, AirPlay on macOS) by something that then never answers,
    which makes the whole app look frozen. Use PORT (default 5050) and step past anything already listening."""
    import socket
    for p in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0: return p
        print(f"  port {p} is already used by another program, trying {p + 1}…")
    return start
if __name__ == "__main__":
    dbm.init_db()
    port = _free_port(int(os.getenv("PORT", "5050")))
    try:   # tell the Vite dev server where the backend is
        with open(os.path.join(os.path.dirname(__file__), "..", "frontend", ".backend-port"), "w") as f: f.write(str(port))
    except OSError: pass
    print(f"\n  Notebook Companion is running:  http://localhost:{port}\n")
    create_app().run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)
