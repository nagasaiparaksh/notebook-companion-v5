"""Usage numbers for the Impact page: what the app actually did for its users (stored locally, never sent anywhere)."""
import json, time
from db import standalone

def log(kind, **data):
    """Never raises: statistics must not break the feature they measure."""
    try:
        d = standalone(); d.execute("INSERT INTO events(kind,data,created) VALUES(?,?,?)", (kind, json.dumps(data, ensure_ascii=False), time.time())); d.commit(); d.close()
    except Exception as e: print("stats log failed:", e)
