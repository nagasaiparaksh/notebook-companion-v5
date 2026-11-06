# What changed
- **Home**: header, Create new notebook, Pinned, Recently edited. Nothing else.
- **New notebook** fixed (the button passed the click event as the title; the server now validates it).
- **Sheets**: unlimited per notebook, stacked-page look, PowerPoint-style sheet panel (toggle, drag to reorder, duplicate, delete). Text that overflows a sheet flows onto the next. Ctrl/Cmd+Enter adds a sheet.
- **Images/visuals**: click to select, drag to move, drag any corner to resize, Delete key. Paste or drop images.
- **Select text** → floating bar: size, font colour, highlight, B/I/U, heading, bullets, ✦ Visualize, Ask.
- **Visualize** (Napkin-style): AI turns the text into a structured spec; 7 layouts × 4 styles × 5 palettes rendered in the browser. Voice: "show me how X looks" works without selected text.
- **Voice**: big mic; one tap, then just talk. The AI decides per utterance: dictation, command or question. One-shot command removed.
- **Companion**: reads every sheet, your selection and visual descriptions; replies are spoken.
- Removed: Formatting / Note tools / Insert image dropdowns.
- **Gemini**: `gemini-2.5-flash` retired (404). Set `LLM_MODEL` in backend/.env; the app also auto-discovers a working Flash model. Status pill shows the real error.

## v3 additions
- **Labelled diagrams** (Visualize dialog → "🏷 Labelled diagram", or say "draw a labelled diagram of the heart"). Built in and instant, even without the AI: human heart, animal cell, flower. Any other subject (volcano, eye, lungs…) is drawn by the AI; the app then places the labels and leader lines itself so they never overlap. Edit label text, choose style/colours, and use "Change style" on the inserted picture later.
- **TTS rate-limit fix** ("Gnani TTS error 429 … Only 1 active request"): voice requests are now sent strictly one at a time (browser and server), with patient retries.
- Selection bar no longer appears shifted off-screen.

## v4 additions
- **Study** (top bar 🎓, or say "quiz me" / "make flashcards" / "what did I miss?"): AI quiz from your own notes (multiple choice, explanations, retry the ones you missed, read aloud), flip flashcards (Again / Got it), and a gap review that lists what your notes are missing and adds it to a new sheet in one click. Works on the whole notebook or one sheet.
- **✦ Visualize sheet**: one click under the page turns everything on the sheet into a diagram.
- **Five more built-in labelled diagrams** (instant, offline): lungs, eye, neuron, water cycle, electric circuit (plus heart, animal cell, flower).
- **File menu**: export as **PDF**, **Word (.docx)** or **Markdown**, all made in your browser; import a **photo or PDF of handwritten/printed notes**: Gemini vision reads each page into new sheets (drag a PDF onto the page works too).
- No sign-up or account: everything runs on your own computer.
- Setup note: PDF import needs `pip install pymupdf` (already in requirements.txt). Photos need no extra package.

## v5
- **Multi-step instructions now run.** "Put the heading as Speech Recognition, a small side heading Unit 1 RNNs, then a summary and a diagram of RNN and its architecture" is treated as an instruction (new `compose` action), not dictation. A server-side safety net enforces this even if the AI misclassifies it. You can also type commands with the ⌨ Type button.
- **Diagrams no longer time out.** Built-in diagrams (RNN, LSTM, GRU, CNN, Transformer, neural network, gradient descent, speech recognition, photosynthesis, water cycle, binary search) appear instantly and are also the fallback when the AI is slow. The server answers within ~32 s, before the browser's 50 s limit.
- **Read-aloud fix.** The voice audio is now detected (WAV/MP3/OGG/base64/raw PCM) and the browser falls back to decoding it itself, so "browser couldn't play the audio" should be gone.
- Clear commands like "undo" or "new sheet" are never dictated as text.

## v6
- **Edit what's already written.** "Replace the heading Speech Recognition with Speech Processing", "change the current heading to Unit 2" (the heading your cursor is in or under), or "replace RNN with recurrent neural network". Looks on the current sheet first, then the others; the side label on a heading is kept. ↶ Undo appears in the caption.
- **Organize notes.** "Organize my notes and remove the overlaps" (whole notebook) or "tidy up this sheet": the AI merges repeated points, groups them under headings and splits run-on dictation, without adding facts. Unchanged lines keep their colours/highlights, pictures and Companion boxes stay put, and the server refuses a result that would drop too much text. One tap undoes it.
- **Add Companion output to your notes.** 📌 Add to notes on every Companion answer, in Study (quiz with answers, flashcards, gap review) and per missing point, or say "add that to my notes" / "summarize this sheet and add it to my notes". It goes in as a small boxed note (smaller font, purple edge) after the paragraph your cursor is in. Exports to PDF/Word/Markdown (as a quote).
- **Read the selection aloud.** Select text → 🔊 Read on the floating bar (■ Stop while it speaks), or say "read the selected text".
- **No more silent "Speaking".** The mic now says "Getting the voice ready…" until sound actually plays. If Gnani's voice service doesn't answer within 45 s (or fails), the answer is read with the browser's own voice and a small note says so; for the next 2 minutes the browser voice is used straight away. The server gives up on a stuck Gnani request after ~60 s instead of retrying for minutes and blocking every later voice request.
- **Delete by voice.** "Delete this sheet" / "delete sheet 3", "delete this" (selected text or the clicked picture), "delete this picture", "delete the heading Speech Recognition", "remove the paragraph about LSTMs", "delete the last line", "remove the summary box", "delete the word basically". All undoable. "Delete this whole notebook" asks you to confirm (say "yes, delete it" or press the button) because that one is permanent.
- **Real undo / redo.** Every change made by voice, a typed command or a button (dictation, edits, organize, compose, deletes, formatting, rename, note boxes, visuals) is kept in a 20-step history. Say "undo", "take that back" or "I didn't mean that" (or press ↶ Undo by the mic) to step back one change at a time; "redo" / ↷ Redo brings it back. Undo also stops a reply that's being read out.
- **Course material per notebook (📚 Material).** Upload the syllabus, lecture slides, a textbook chapter or handouts: PDF (scanned pages are read by AI, first 6 per file), Word .docx, PowerPoint .pptx, text/Markdown, photos of pages, or pasted text. Each item gets a short AI brief (what it covers, its topics, key terms) and is indexed for retrieval. From then on the AI uses it: dictation fixes misheard technical terms ("are and ends" → "RNNs"), the Companion answers from it ("your course material says…"), compose writes summaries and diagrams from it, "What did I miss?" lists what the material covers that your notes don't, quizzes are checked against it, and organize corrects misspelled terms. Your notes are never changed by adding material. Say "add course material" to open it. Undo history is now kept per notebook.
- **Read-aloud fixed everywhere** (read sheet/notebook/selection, 🔊 Read, Companion replies and ▶ Listen, Companion page, quiz 🔊 Read aloud, voice test). Root cause: Gnani streams WAV with a placeholder length, so its header claimed ~25 hours of audio and browsers never finished (or never started) playing it; the server now writes the real length. Also: long text is split into ≤280-character pieces (the server reads at most 600 per request, so long bullets/selections used to be cut off); playback can no longer hang on "Speaking" (watchdog after each clip's real length); audio that still can't be played is read with the browser's own voice; Chrome's built-in voice no longer stalls on long text; ▶ Listen and quiz Read aloud now toggle to ■ Stop and show errors instead of failing silently.

## v7: easy to start, worth switching to
- **Guided first notebook.** Home shows "✨ New here?": it opens a practice notebook with an 8-step tour (talk to write, ask it to write, a diagram, edit by voice, undo, listen, quiz, add material / record a lecture). Each step has "Try it for me", which runs the real command, so it works without a microphone. "✨ Guided tour" on Home replays it.
- **🎙 Lecture mode.** Record a whole class. Audio is cut at natural pauses into ~25-45 s pieces and transcribed while you record (pause / resume / continue; the transcript is kept in the browser, so a refresh or crash doesn't lose it; failed pieces can be retried). Fix the transcript if you like, then "✦ Make notes": organized notes with headings, key terms, announcements and "to review or ask", with technical terms corrected from your course material, spread over new sheets; optionally the full transcript too. Notes can be written in English or another language. Say "record the lecture" to open it. Undoable.
- **📊 Syllabus coverage.** In 📚 Material: each course topic is marked ✓ covered / ◐ partly / ✗ missing (with the sheet it's on), a % is shown on the 📚 button, and "✍ Add notes" writes a short section for a missing topic from your material. Checked automatically after adding material; a keyword check is used when the AI is unavailable.
- **Word import.** File → "Word document / Markdown / text" imports .docx (headings, bullet lists, bold/italic/underline, tables, page breaks), .md and .txt into new sheets; Home → "Open a Word document as a notebook" makes a new notebook from one. Pictures inside Word files aren't brought in (you're told how many).
- **Backups.** Every notebook is backed up automatically (on start-up and every 6 h while you work; newest 14 kept) to backend/backups, or to BACKUP_DIR: point it at a OneDrive / Google Drive folder to sync to the cloud. Home → Backups: download all notebooks as one file, restore from a file (nothing is overwritten; notebooks you already have are skipped), or back up now. File → "Backup of this notebook" saves just one.

## v7.1: quality pass
- **Faster voice commands.** Clear commands ("undo", "new sheet", "delete this sheet", "read the selected text", "put a heading … and a summary") are recognised instantly, without an AI round-trip; only dictation and unclear requests go to the AI.
- **Lighter undo.** History snapshots no longer re-serialise every picture on each utterance, which made notebooks with images slow and memory-hungry.
- **Cleaner top bar.** ← and ▤ on the left, then the title; Companion, Lecture, Study, Material (with a coverage % badge), File and ⚙ Settings on the right. Language and voice moved under ⚙. Labels hide on narrow screens; on phones the title gets its own line.
- **Replies don't cover the page.** The bubble above the mic shows at most 3 lines; long answers have "Read it all in the Companion ›". Redo only appears when there is something to redo.
- **Organize shows a preview.** Before/after for each sheet, then Apply or Cancel (or say "apply" / "cancel"). Sheets you edited while it was working are left alone.
- **Lecture mode is safer.** The screen stays awake while recording; suspended audio is resumed; an unplugged mic or 20 s without audio is reported (the transcript is kept, press Continue). Clicking 🎙 Lecture or Companion no longer stops a recording, the button shows "Recording…", and leaving the notebook mid-recording asks first.
- **Fewer misheard terms.** The notebook's own acronyms and names are sent with every utterance, so dictation spells them consistently even without course material.

## v8: built on Gnani
- **Prisma v3.0 everywhere** (was the default v2.5). Fixes lecture pieces being rejected: Gnani REST takes at most 30 s per request, pieces are now ≤28 s.
- **Syllabus-aware speech recognition.** Every transcription sends Gnani the notebook's course terms (up to 200 keyterms from the uploaded material and the notes themselves), a topic description and the previous sentence. Measured on real Gnani output: "back propagation" → "backpropagation through time" once the course terms are sent.
- **Indian languages and code-mixed speech.** ⚙ Settings → "What you speak": English, any of 9 Indian languages, "Telugu/Hindi/Tamil/… + English (mixed)" (Gnani's codemix format keeps English technical words in Latin script), or auto-detect. The detected language is shown on each caption.
- **Live lecture captions.** Lecture mode streams audio through a WebSocket relay (the API key stays on the server) to Gnani's realtime STT; each sentence appears about a second after it is spoken. Sessions are rolled over before Gnani's 15-minute limit. If the live connection can't open or drops, it falls back to ~25 s pieces automatically.
- **Upload a recorded lecture** (voice memo up to 10 MB) → Gnani Batch with denoising and speaker labels: the transcript reads "Teacher: … / Student 1: …", and the notes get a "Questions from class" section.
- **Hear it in your language.** "🔊 Telugu" (etc.) on selected text and on Companion replies, or say "read this in Telugu": the AI explains it in simple spoken Telugu (technical terms kept in English) and Gnani Timbre reads it.
- **🔬 Accuracy test** (📚 Material): record 20 s; Gnani transcribes it with and without the course terms, side by side with the recognised terms highlighted.
- **📈 Impact page** (Home): minutes transcribed, share with course context, languages used, accuracy-test results, lectures, study sets, coverage, active days, plus a feedback box whose quotes are listed. All local.
- Requires `pip install -r backend/requirements.txt` (adds flask-sock and websockets).

## v8.1: speed
- **The AI no longer "thinks" on quick requests.** The app was sending `reasoning_effort: minimal` to Gemini 3, which switched thinking on; one short classification took ~14 s. Without it: ~1 s. (`LLM_REASONING_EFFORT=none` now means "don't send it".)
- **Dictation is written instantly.** Ordinary note sentences skip the AI entirely (fillers like "um" removed, "new line" / "full stop" / "comma" handled locally); only questions and unclear requests go to the AI, with a 12 s cap before falling back to rules. Measured in the browser: 0.2 s to text on the page.
- **More forgiving read-aloud command.** "read the sheet out loud please", "can you read the whole notebook", "please read out the page", "read the sheet in Telugu" are all recognised instantly.
- **Read-aloud starts sooner.** Gnani Timbre's streaming (SSE) API is used: audio plays as it arrives, back to back on one timeline, while the next sentence is fetched (2.1 s to first sound in the browser, was 3.1 s). Falls back to Gnani REST, then the browser's voice.
- **Quiz in two parts.** The first 3 questions appear in ~5-6 s, the other 5 are added while you answer (was ~18 s for all 8). Flashcards: 5 first, 7 more after.
- **Page loads no longer spend an AI call** on the status check (it took up to 20 s and used up the rate limit, slowing everything else); a recent successful call or check is reused.

## v8.2: tested end to end
- **Automated browser test suite** (`tests/e2e.py`, see tests/README.md): 29 features driven in real Edge with a fake microphone, on a fresh database. Test mode (AI + Gnani mocked via `NC_MOCK=1`) passes 29/29; `--live` runs the same checks against the real services.
- **Fixed: live lecture captions ended with a browser WebSocket error** ("Invalid frame header"): the dev server wrote an HTTP reply onto the closed WebSocket. The connection is now closed cleanly.
- **Fixed: one slow AI request could take several timeouts** (a 12 s classification took 31 s) because each fallback model got a fresh full timeout. Each request now has one overall time budget, then falls back to rules.

## v8.3: study material on request
- **Fixed: a spoken request was pasted as dictation** ("I have an exam tomorrow on Spring Boot … help me by generating 3 to 4 situational questions and answers"). The instant-dictation shortcut now steps aside for requests anywhere in the sentence ("help me", "generate", "questions and answers", "I need" …), and a rule recognises study-material requests even when the AI is unavailable.
- **The notebook can now write study material**: practice / exam / situational questions with worked answers and real code blocks (monospace, kept intact by organize, exported as code in Markdown and Word). Long material goes onto its own sheets. Uses your course material when present.
- The test suite has a check with that exact request (30 checks, 30 pass in test mode).

## v8.4
- **Fixed: Companion answers in Telugu / Hindi (and "–", narrow spaces) came out garbled** ("à°à°°à±…", "Sheetâ¯3"). Groq's stream doesn't name its text encoding, so it was decoded as Latin-1; streams are now always read as UTF-8.
- **Fixed: diagrams overlapping each other and the text.** Every diagram / picture now takes its place in the text flow (an invisible spacer of its height), like a figure in Word: text written later goes below it, diagrams stack instead of landing on the same spot, and a diagram moves to the next sheet with its place when the page fills. Dragging one by hand makes it float exactly where you put it. Older notebooks are untangled when the sheet opens. New test: "diagrams never overlap the text or each other" (31/31 pass).

## v8.5: listening fixes
- **The listening language is shown under the mic** ("🎤 Listening for …") and can be changed there in one click (it also becomes the default for new notebooks). Notebooks had silently been set to Hindi from an old browser setting.
- **English is always understood too**: a single Indian language (e.g. Hindi) is sent to Gnani as "Hindi + English", so English speech isn't lost.
- **"I didn't catch that"** is shown when a recording comes back empty, instead of nothing happening.
- **previous_text is only what was just said** (as Gnani's docs intend), not the end of the sheet.
- **Requests in the middle of a sentence are carried out**: "… I am asking you to generate a diagram of photosynthesis" draws it (misheard words before the request are dropped); "draw a flowchart of the water cycle" draws the water cycle, not the current sheet.

## Accounts: many people, each with their own notebooks
- **Log in with a username and password.** New people press "New here? Create an account" and pick a username (3–32 letters, numbers, dots, dashes or underscores) and a password (6+ characters). Passwords are stored hashed; logins last 30 days. Your name and **Log out** are in the top right.
- **Everything is private to its account:** notebooks, sheets, course material, coverage, Companion chats, diagrams, search, the notes graph, backup download / restore and the Impact numbers. Asking for someone else's notebook (by id, in a chat, a quiz, a voice command or live captions) gets "not found".
- **Existing notebooks aren't lost:** the first account created on an existing install takes over all notebooks made before accounts existed. Every later account starts with only the guided tour, "Create new notebook" and one notebook, "Why use this notebook?", that explains what the app does for you.
- If a login runs out while you work, a "Please log in again" box appears over the page and your unsaved work stays put.
- Hosting online: set `SECRET_KEY` in backend/.env (see .env.example). `APP_ACCESS_CODE` still works as an extra lock in front of the login.
