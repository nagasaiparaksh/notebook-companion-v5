# Tests

Run these before every demo or deployment. Each one starts its own server on a fresh, empty database, so your notebooks are never touched.

```
backend\.venv\Scripts\python.exe -m pip install playwright      (once)
backend\.venv\Scripts\python.exe tests\e2e.py                   test mode: AI + Gnani mocked, ~1.5 min, free
backend\.venv\Scripts\python.exe tests\e2e.py --live            real AI + Gnani (uses credits / rate limit)
```

The suite drives the real app in Microsoft Edge (or Chrome) with a fake microphone and checks 29 features end to end: notebooks, saving, dictation and commands, compose and diagrams, editing, undo/redo, the selection bar, read-aloud, deleting, organize, the Companion, study (quiz, flashcards, gaps), course material, syllabus coverage, the accuracy test, lecture mode (live captions), export, Word import, settings, backups, the Impact page, the guided tour and a phone-size screen.

It prints PASS/FAIL per feature, then every page crash, console error, failed request and server error it saw, and saves a screenshot of each failure. Exit code 0 = everything passed.

Test mode (`NC_MOCK=1`, set automatically) replaces the AI and Gnani with predictable stand-ins (`backend/services/mock.py`) so the app's own logic is checked quickly and repeatably. `--live` runs the same checks against the real services, which is what finds provider problems (slowness, rate limits, outages). With the fake microphone the live lecture check only confirms the Gnani live link opens; test real speech yourself.
