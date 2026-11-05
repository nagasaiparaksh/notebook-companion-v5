import sqlite3, json, time
from flask import g
import config
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, language TEXT DEFAULT 'en-IN');
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT, content TEXT, language TEXT DEFAULT 'en-IN',
  category TEXT DEFAULT '', tags TEXT DEFAULT '[]', summary_short TEXT DEFAULT '', summary_detailed TEXT DEFAULT '',
  key_points TEXT DEFAULT '[]', definitions TEXT DEFAULT '[]', transcript TEXT DEFAULT '', audio_ref TEXT DEFAULT '',
  diagram_ids TEXT DEFAULT '[]', pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created REAL, updated REAL, sheets TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, note_id INTEGER, text TEXT, deadline TEXT DEFAULT '', done INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS embeddings(id INTEGER PRIMARY KEY, kind TEXT, ref_id INTEGER, chunk TEXT, provider TEXT, vec TEXT);
CREATE TABLE IF NOT EXISTS diagrams(id INTEGER PRIMARY KEY, title TEXT, data TEXT, svg TEXT DEFAULT '', created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, title TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT, sources TEXT DEFAULT '[]', created REAL);
CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY, note_id INTEGER, name TEXT, kind TEXT, text TEXT, summary TEXT DEFAULT '',
  topics TEXT DEFAULT '[]', terms TEXT DEFAULT '[]', chars INTEGER DEFAULT 0, created REAL);
CREATE INDEX IF NOT EXISTS materials_note ON materials(note_id);
CREATE TABLE IF NOT EXISTS coverage(note_id INTEGER PRIMARY KEY, data TEXT, created REAL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, kind TEXT, data TEXT, created REAL);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind);
"""
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(config.DATABASE_PATH, timeout=15); g.db.row_factory = sqlite3.Row; g.db.execute("PRAGMA busy_timeout=15000")
    return g.db
def close_db(e=None):
    d = g.pop("db", None)
    if d: d.close()
def standalone():
    d = sqlite3.connect(config.DATABASE_PATH, timeout=15); d.row_factory = sqlite3.Row; return d
def init_db():
    d = standalone(); d.execute("PRAGMA journal_mode=WAL"); d.executescript(SCHEMA)
    if "sheets" not in {r["name"] for r in d.execute("PRAGMA table_info(notes)")}:   # older databases: add the multi-sheet column
        d.execute("ALTER TABLE notes ADD COLUMN sheets TEXT DEFAULT ''")
    have = {r["name"] for r in d.execute("PRAGMA table_info(materials)")}
    for col in ("pages", "pages_read"):                                                # materials from before page counts were kept
        if col not in have: d.execute(f"ALTER TABLE materials ADD COLUMN {col} INTEGER DEFAULT 0")
    if not d.execute("SELECT 1 FROM users").fetchone(): d.execute("INSERT INTO users(name) VALUES('Friend')")
    d.commit(); d.close()
JSON_FIELDS = ("tags", "key_points", "definitions", "diagram_ids")
def note_row(r, full=True):
    n = dict(r)
    for f in JSON_FIELDS: n[f] = json.loads(n.get(f) or "[]")
    try: n["sheets"] = json.loads(n.get("sheets") or "[]")
    except Exception: n["sheets"] = []
    if not full: n.pop("content", None); n.pop("transcript", None); n.pop("sheets", None)
    return n
def now(): return time.time()
