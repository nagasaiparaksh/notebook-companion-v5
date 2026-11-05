"""Study loop built on the notebook's own content: quiz, flashcards, and "what did I miss?"."""
import json, random
from flask import Blueprint, request, jsonify
from db import get_db
from services import llm, sheets as sh, materials
bp = Blueprint("study", __name__)

COMMON = "Use ONLY the notebook content below as the source of truth for what the student wrote. Write in the same language as the notes. Be accurate and concise."
QUIZ = """You are a tutor writing a revision quiz from a student's own notes. Return ONLY JSON:
{"title":str,"questions":[{"q":str,"options":[4 strings],"answer":0-3 (index of the single correct option),"explanation":str(<=25 words, why it is correct),"sheet":number|null (sheet the fact is on)}]}
Write exactly {n} questions that test understanding of the most important ideas, not trivia. Options must be plausible, similar in length, with exactly one correct answer; never use "all of the above". Mix recall and 'why/how' questions. """ + COMMON
CARDS = """You are a tutor turning a student's notes into flashcards. Return ONLY JSON:
{"title":str,"cards":[{"front":str(a question or term, <=18 words),"back":str(the answer, <=30 words),"sheet":number|null}]}
Write {n} cards covering the key terms, definitions, steps and relationships. One idea per card. """ + COMMON
GAPS = """You are a tutor reviewing a student's notes for gaps. Return ONLY JSON:
{"topic":str,"verdict":str(1-2 sentences: how complete the notes are),"covered":[str, up to 6 short points the notes already handle well],
 "missing":[{"topic":str(<=6 words),"why":str(<=20 words, why a student should know it),"add":str(2-3 sentences of notes the student could add, ready to paste)}],
 "unclear":[{"point":str(quote or paraphrase of something in the notes),"fix":str(what is wrong or vague and the correction)}]}
Work out the subject from the notes, then use your own accurate knowledge of what a student studying that subject should know to list 3 to 6 important points that are MISSING from the notes. List "unclear" only for things that are actually wrong or too vague (otherwise an empty list). Do not invent things the notes say. """ + COMMON

def _notebook(note_id, sheet_index=None, limit=14000):
    row = get_db().execute("SELECT title,content,sheets FROM notes WHERE id=?", (int(note_id),)).fetchone()
    if not row: return None, None
    try: sheets = sh.normalize(json.loads(row["sheets"] or "[]"), row["content"])
    except Exception: sheets = sh.normalize(None, row["content"])
    if isinstance(sheet_index, int) and 0 <= sheet_index < len(sheets):
        return row["title"], f"=== Sheet {sheet_index + 1} of {len(sheets)} ===\n{sh.sheet_plain(sheets[sheet_index])}"
    return row["title"], sh.notebook_text(sheets, limit)

def _s(v, n): return str(v or "").strip()[:n]

@bp.post("/study/generate")
def generate():
    d = request.json or {}; mode = d.get("mode"); nid = d.get("note_id")
    if mode not in ("quiz", "flashcards", "gaps"): return jsonify(error="Unknown study mode."), 400
    if not nid: return jsonify(error="Open a notebook first."), 400
    title, text = _notebook(nid, d.get("sheet_index") if d.get("scope") == "sheet" else None)
    if text is None: return jsonify(error="Notebook not found."), 404
    body = text.split("\n", 1)[-1] if text.startswith("=== Sheet 1 of 1") else text
    if len(body.replace("=== Sheet", "").strip()) < 60: return jsonify(error="There's hardly anything in this notebook yet. Write or dictate a few sentences first, then I can test you on them."), 400
    n = max(2, min(15, int(d.get("count") or (8 if mode == "quiz" else 12))))
    prompt = {"quiz": QUIZ, "flashcards": CARDS, "gaps": GAPS}[mode].replace("{n}", str(n))
    avoid = [str(a)[:200] for a in (d.get("avoid") or [])][:30]     # the app loads a quiz in two parts: the second must not repeat the first
    if avoid: prompt += "\nDo NOT repeat or rephrase any of these, which the student already has:\n- " + "\n- ".join(avoid)
    mat = materials.context(get_db(), nid, f"{title}. {body[:1500]}", k=10 if mode == "gaps" else 6, limit=7000 if mode == "gaps" else 4000)
    if mat: prompt += ("\nCOURSE MATERIAL is given below: the missing points MUST come from it (important things the material covers that the notes don't), and 'unclear' should flag notes that contradict it. Mention the material by name in 'why'."
                       if mode == "gaps" else "\nCOURSE MATERIAL is given below: use it to make sure every answer and explanation is correct and uses the course's terms, but test what the NOTES cover.")
    try: j = llm.chat_json([{"role": "system", "content": prompt}, {"role": "user", "content": f"NOTEBOOK TITLE: {title}\n\nNOTEBOOK CONTENT:\n{text}" + (f"\n\n{mat}" if mat else "")}], max_tokens=min(5000, 400 + n * 320), timeout=(6, 75))
    except Exception as e: return jsonify(error="The AI couldn't prepare that right now: " + str(e)[:200]), 503
    from services import stats; stats.log("study", mode=mode, scope=d.get("scope"), material=bool(mat))
    try:
        if mode == "quiz":
            qs = []
            for q in j.get("questions") or []:
                opts = [_s(o, 160) for o in (q.get("options") or [])][:4]
                try: a = int(q.get("answer"))
                except Exception: continue
                if len(opts) != 4 or not all(opts) or not 0 <= a < 4 or len(set(opts)) < 4 or not _s(q.get("q"), 300): continue
                order = list(range(4)); random.shuffle(order)       # models like putting the right answer first or second
                qs.append({"q": _s(q["q"], 300), "options": [opts[i] for i in order], "answer": order.index(a), "explanation": _s(q.get("explanation"), 220),
                           "sheet": q.get("sheet") if isinstance(q.get("sheet"), int) else None})
            if len(qs) < 2: raise ValueError("the model wrote too few usable questions")
            return jsonify({"mode": mode, "title": _s(j.get("title"), 80) or title, "questions": qs[:n]})
        if mode == "flashcards":
            cs = [{"front": _s(c.get("front"), 200), "back": _s(c.get("back"), 320), "sheet": c.get("sheet") if isinstance(c.get("sheet"), int) else None}
                  for c in (j.get("cards") or []) if isinstance(c, dict) and _s(c.get("front"), 5) and _s(c.get("back"), 2)]
            if len(cs) < 2: raise ValueError("the model wrote too few usable cards")
            return jsonify({"mode": mode, "title": _s(j.get("title"), 80) or title, "cards": cs[:n]})
        miss = [{"topic": _s(m.get("topic"), 60), "why": _s(m.get("why"), 200), "add": _s(m.get("add"), 600)} for m in (j.get("missing") or []) if isinstance(m, dict) and _s(m.get("topic"), 2)]
        unc = [{"point": _s(u.get("point"), 240), "fix": _s(u.get("fix"), 360)} for u in (j.get("unclear") or []) if isinstance(u, dict) and _s(u.get("point"), 2)]
        return jsonify({"mode": mode, "topic": _s(j.get("topic"), 80) or title, "verdict": _s(j.get("verdict"), 300), "covered": [_s(c, 120) for c in (j.get("covered") or [])][:6], "missing": miss[:7], "unclear": unc[:5]})
    except ValueError as e: return jsonify(error="The AI's answer wasn't usable (" + str(e) + "). Please try again."), 503
