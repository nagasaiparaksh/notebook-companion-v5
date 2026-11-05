# Notebook Companion — voice-first notebook (v2 redesign)

If you still see tabs (My Space / Notes / Companion / Capture…) or an "Image width" toolbar, you are running the OLD folder.
The new app opens on a page with only: header → **Create new notebook** → **Pinned** → **Recently edited**.

## Run
**Windows, easiest:** double-click `start.bat`. It installs what's missing, builds the app the first time, starts the server and opens the browser.
The server uses port **5050** (port 5000 is often held by Docker/WSL on Windows and never answers, which makes the app look frozen); it skips any port already in use and prints the address it got. After pulling new code, run `cd frontend && npm run build` (or delete `frontend/dist`) so start.bat rebuilds.

Manual steps:
1. `cd backend && python -m venv .venv && . .venv/bin/activate` (Windows: `.venv\Scripts\activate`) then `pip install -r requirements.txt` (includes PyMuPDF for PDF import)
2. Copy `backend/.env.example` to `backend/.env`; add `LLM_API_KEY`, `GNANI_API_KEY`; set `LLM_MODEL` to a current Gemini Flash model (`gemini-2.5-flash` is retired; the app also auto-discovers one).
3. `python app.py` → open the address it prints, normally http://localhost:5050 (serves the built UI), **or** for live editing: `cd frontend && npm install && npm run dev` → http://localhost:5173
4. After changing frontend code: `cd frontend && npm run build`.
Hard-refresh the browser (Ctrl+Shift+R) after upgrading.

## Using it
- **Mic (big circle, bottom):** tap once, then talk. The AI decides per utterance: dictation (written into the sheet), command ("new sheet", "go to sheet 2", "make this red and bigger", "turn this into a flowchart", "show me how an amoeba looks"), or question (answered aloud using the whole notebook).
- **Sheets:** unlimited; panel on the left (▤ Sheets) like PowerPoint; text overflows onto the next sheet; Ctrl/Cmd+Enter adds one.
- **Images / visuals:** click to select, drag to move, drag corners to resize, Delete to remove. Paste or drop images.
- **Labelled diagrams:** say "draw a labelled diagram of the heart", or select text → ✦ Visualize → 🏷 Labelled diagram. Heart, animal cell and flower are built in; other subjects are drawn by the AI.
- **Select text:** floating bar with size, colour, highlight, B/I/U, heading, bullets, ✦ Visualize (Napkin-style diagrams), Ask.
- **🎓 Study:** quiz, flashcards, and "what did I miss?" generated from your notes (or say "quiz me").
- **File ▾:** export PDF / Word / Markdown; import a photo or PDF of handwritten notes (AI reads it into sheets). No account needed.
- **✦ Companion:** reads every sheet, your selection and visuals; replies are spoken.
See CHANGES.md for details.
- **✨ First time?** Home → "Start the tour": a 1-minute guided notebook.
- **🎙 Lecture:** record a whole class, then "Make notes" (headings, key terms, announcements; terms checked against your course material).
- **📚 Material → 📊 Syllabus coverage:** which course topics your notes cover; "✍ Add notes" fills a gap.
- **Word import / backups:** File → import a .docx; Home → Backups (automatic copies in backend/backups, or set `BACKUP_DIR` to a OneDrive/Google Drive folder to sync them).
