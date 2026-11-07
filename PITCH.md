# ✎ Notebook Companion: solution pitch

**A study notebook you can just talk to, built on Gnani AI.** (One-page PDF: [PITCH.pdf](PITCH.pdf))

**Live:** https://notebook-companion.onrender.com · **Demo video (3:35):** [demo-video/notebook-companion-voice.mp4](demo-video/notebook-companion-voice.mp4)

## The problem
Students write while the teacher talks, so they listen less and copy more. Indian classrooms are spoken and code-mixed, but note apps are English-first and typing-first. Generic speech tools mishear course terms, and notes stay passive: nothing quizzes you or shows what you missed.

## The solution
A voice-first notebook: **tap the mic once and talk.** For every sentence the AI decides whether it is dictation, a command or a question, then writes, acts or answers. Students upload their syllabus or slides, and from then on recognition, answers, quizzes and "what did I miss?" follow their course.

**Everything by voice:** dictation · "Write a summary with a heading and a diagram" · "Change the heading to…" / "Undo that" · "Explain my notes simply" (spoken answer from your notes) · "Add that to my notes" · "Quiz me" / "Make flashcards" / "What did I miss?" · "Record the lecture" (live captions → organised notes) · Hindi + English in one sentence.

## Gnani APIs used
| API | Used for |
|---|---|
| Prisma v3.0 STT (REST) | Dictation and commands; keyterms, topic and previous_text from the student's course material; code-mixed output |
| Prisma v3.0 Streaming STT | Live lecture captions over WebSocket, relayed by the server (key never in the browser), 15-min session rollover |
| Prisma v3.0 Batch STT | Uploaded lecture recordings with speaker diarization (teacher vs students) |
| Timbre v3.0 TTS (REST + SSE) | Answers and read-aloud, streaming so speech starts in about 1 s; 13 voices |

## What makes it different
- **Syllabus-aware recognition:** course terms boost Gnani Prisma; a built-in A/B test shows the difference.
- **Code-mixed first:** English + 9 Indian languages, mixes of them, or auto-detect.
- **Acts, not just transcribes:** writes, edits, draws, quizzes, all undoable.
- **Active recall:** every notebook becomes a quiz, flashcards and a gap check.
- **Private:** per-user accounts; export to PDF, Word or Markdown.

## Market & impact (assumptions)
India has ~4.5 crore higher-education students (AISHE 2023-24) and ~24.7 crore school students (UDISE+ 2024-25); its edtech market is projected to grow from $7.5B (2024) to ~$29B by 2030 (IAMAI–Grant Thornton). If 1% of college students paid ₹99/month, that is 4.5 lakh users ≈ ₹53 crore a year, before school and coaching students or college-wide licences. Voice-first also helps learners who write slowly or have motor or visual difficulties.

## Built with
React + TypeScript + Vite · Python Flask · SQLite · WebSockets · Gemini LLM with automatic fallback · RAG over notes and syllabus · Docker on Render · 32 Playwright end-to-end tests

**Next:** Android app with offline drafts, a teacher view that shares a lecture's notes with the whole class, and syllabus packs for common university courses.

*Built by Y Naga Sai Paraksh for the Gnani AI competition.*
