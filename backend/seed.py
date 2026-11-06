"""What a new account starts with: one notebook that explains why to use the app. Nothing else
(the Home page adds the guided tour and "Create new notebook" itself)."""
import json
from db import now
from services import rag, sheets as sh

TITLE = "Why use this notebook?"
SHEETS = [
 """<h2>Why use this notebook?</h2>
<p>Because you can <b>talk</b> instead of type. Press the big mic and just speak: your words are written down as neat notes, in English, an Indian language, or a mix of both.</p>
<h2>It writes for you</h2>
<ul><li>Say <i>"put a heading Photosynthesis and a short summary"</i> and it does.</li>
<li>Say <i>"draw a diagram of how the heart works"</i> and a labelled diagram appears on the page.</li>
<li>Say <i>"organize my notes"</i> and repeated, messy dictation becomes clean headings and points.</li></ul>
<h2>Edit by voice, safely</h2>
<p>"Change the heading to Unit 2", "replace RNN with recurrent neural network", "delete the last line". Changed your mind? Say <b>"undo"</b>.</p>""",
 """<h2>It helps you study, not just store</h2>
<ul><li><b>Companion:</b> ask questions about your own notes and get short, spoken answers.</li>
<li><b>🎓 Study:</b> a quiz, flashcards, or "what did I miss?" made from your notes.</li>
<li><b>🔊 Listen:</b> any sheet or selection is read aloud, so you can revise on the go.</li></ul>
<h2>It understands your course</h2>
<p>Add your syllabus or slides with <b>📚 Material</b>. Technical terms are then spelled right, answers follow your course, and you can see which syllabus topics your notes still miss.</p>
<h2>It keeps up with class</h2>
<p><b>🎙 Lecture</b> records a whole class and turns it into organised notes with key terms.</p>
<h2>Your notes stay yours</h2>
<p>Your notebooks are private to your account. Export them as PDF, Word or Markdown at any time.</p>
<p><b>Next:</b> press <b>Start the tour</b> on the home page, or <b>Create new notebook</b> and say something.</p>""",
]

def for_user(db, uid):
    t = now(); sheets = sh.normalize([{"html": h, "objects": []} for h in SHEETS]); content = sh.content_from(sheets)
    nid = db.execute("INSERT INTO notes(title,content,sheets,category,created,updated,pinned,user_id) VALUES(?,?,?,?,?,?,?,?)",
                     (TITLE, content, json.dumps(sheets), "Getting started", t, t, 1, uid)).lastrowid
    db.commit()
    try: rag.index("note", nid, f"{TITLE}. {content}", db); db.commit()
    except Exception as e: print("welcome notebook indexing failed:", e)
