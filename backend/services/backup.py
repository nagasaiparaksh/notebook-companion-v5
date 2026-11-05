"""Automatic backups of the whole library (every notebook, sheet, picture and course material).
A consistent copy of the SQLite database is written at most every 6 hours (and on start-up), and the newest 14 are kept.
Set BACKUP_DIR in backend/.env to a OneDrive / Google Drive / Dropbox folder and the backups sync to the cloud on their own."""
import glob, os, sqlite3, threading, time
import config

DIR = os.path.abspath(config.env("BACKUP_DIR", "") or os.path.join(os.path.dirname(os.path.abspath(config.DATABASE_PATH)), "backups"))
KEEP, EVERY = 14, 6 * 3600
_lock = threading.Lock()

def _files(): return sorted(glob.glob(os.path.join(DIR, "notes-*.db")))

def snapshot(force=False):
    """Copy the database if the newest backup is older than EVERY (or force). Never raises: a failed backup must not break saving."""
    try:
        with _lock:
            files = _files()
            if not force and files and time.time() - os.path.getmtime(files[-1]) < EVERY: return None
            if not os.path.exists(config.DATABASE_PATH): return None
            os.makedirs(DIR, exist_ok=True); name = os.path.join(DIR, time.strftime("notes-%Y%m%d-%H%M%S.db"))
            src, dst = sqlite3.connect(config.DATABASE_PATH, timeout=15), sqlite3.connect(name)
            try: src.backup(dst)                      # SQLite's online backup: a consistent copy even while the app is writing
            finally: dst.close(); src.close()
            for old in _files()[:-KEEP]:
                try: os.remove(old)
                except OSError: pass
            return name
    except Exception as e:
        print("backup failed:", e); return None

def status():
    files = _files()
    return {"dir": DIR, "count": len(files), "last": os.path.getmtime(files[-1]) if files else None, "keep": KEEP, "every_hours": EVERY // 3600,
            "cloud": any(k in DIR.lower() for k in ("onedrive", "google drive", "googledrive", "dropbox", "icloud"))}
