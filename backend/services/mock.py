"""Test mode (NC_MOCK=1): the AI and Gnani are replaced by fast, predictable stand-ins with the same shapes,
so the end-to-end suite can check every feature without network, credits or rate limits. Never active in normal use."""
import json, math, re, struct, time

def _wav(seconds=0.6, rate=24000):
    n = int(seconds * rate); data = b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n))
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(data)) + data

def _sheets(user):
    """Organize: echo the outline back as blocks (keeps every box), one entry per sheet."""
    out = []
    for m in re.finditer(r"=== Sheet (\d+) ===\n(.*?)(?=\n\n=== Sheet |\Z)", user, re.S):
        blocks, seen = [], set()
        for line in m.group(2).splitlines():
            l = line.strip()
            if not l or l == "(empty)": continue
            if re.fullmatch(r"\[\[box \d+\]\]", l): blocks.append({"type": "keep", "ref": l.strip("[]")}); continue
            if l.startswith("## "): blocks.append({"type": "heading", "text": re.sub(r"\s*\{tag:.*\}$", "", l[3:])}); continue
            txt = re.sub(r"^(- |\d+\. )", "", l)
            if txt.lower() in seen: continue                      # "remove overlaps"
            seen.add(txt.lower()); blocks.append({"type": "paragraph", "text": txt})
        out.append({"sheet": int(m.group(1)), "blocks": blocks})
    return {"say": "Merged repeated lines and kept your headings.", "sheets": out}

def chat_json(messages, max_tokens=4096, timeout=None):
    sys_ = str(messages[0].get("content")) if messages else ""; user = str(messages[-1].get("content"))
    if "voice brain" in sys_:
        u = user.split("UTTERANCE\n", 1)[-1].strip()
        if "?" in u or re.match(r"(what|why|how|explain|tell me)\b", u, re.I): return {"type": "question", "action": None, "args": {}, "text": u, "confidence": .9}
        m = re.match(r"replace (.+?) with (.+?)\.?$", u, re.I)
        if m: return {"type": "command", "action": "edit_text", "args": {"what": "text", "target": m.group(1), "replacement": m.group(2)}, "text": u, "confidence": .9}
        if re.match(r"make (this|the selected text|it) (red|blue|green)", u, re.I): return {"type": "command", "action": "format", "args": {"color": u.split()[-1]}, "text": u, "confidence": .9}
        return {"type": "dictate", "action": None, "args": {}, "text": u, "confidence": .9}
    if "writing hand" in sys_:
        ins = user.split("INSTRUCTION (spoken)\n", 1)[-1].split("\n\n", 1)[0]
        if re.search(r"question|code|example", ins, re.I):
            b = [{"type": "heading", "text": "Spring Boot: practice questions"}]
            for i in range(1, 4):
                b += [{"type": "question", "text": f"Q{i}. Situation {i}: your service needs feature {i}. How do you build it?"}, {"type": "paragraph", "text": f"Answer {i}: use the right starter."},
                      {"type": "code", "lang": "java", "text": f"@RestController\npublic class Demo{i}Controller {{\n    @GetMapping(\"/demo{i}\")\n    public String hello() {{ return \"ok\"; }}\n}}"}]
            return {"say": "Wrote 3 situational questions with answers and code.", "blocks": b}
        topic = (re.search(r"(?:heading|of) ([A-Za-z ]+?)(?: with| and|,|$)", ins) or [None, "Photosynthesis"])[1].strip().title()
        b = [{"type": "heading", "text": topic, "tag": "Unit 1"}, {"type": "paragraph", "text": f"{topic} is summarised here."}, {"type": "bullets", "items": ["First key point", "Second key point", "Third key point"]}]
        if re.search(r"diagram|visual|flowchart", ins, re.I): b.append({"type": "visual", "mode": "infographic", "topic": topic, "kind": "process"})
        return {"say": f"Added a heading and summary for {topic}.", "blocks": b}
    if "tidy up a student's notebook" in sys_: return _sheets(user)
    if "revision quiz" in sys_:
        n = int((re.search(r"Write exactly (\d+)", sys_) or [0, 5])[1]); base = len(re.findall(r"^- ", sys_, re.M))
        return {"title": "Quiz", "questions": [{"q": f"Mock question {base + i + 1} about the notes?", "options": [f"Right {i}", f"Wrong A{i}", f"Wrong B{i}", f"Wrong C{i}"], "answer": 0, "explanation": "Because the notes say so.", "sheet": 1} for i in range(n)]}
    if "into flashcards" in sys_:
        n = int((re.search(r"Write (\d+) cards", sys_) or [0, 6])[1]); base = len(re.findall(r"^- ", sys_, re.M))
        return {"title": "Cards", "cards": [{"front": f"Mock term {base + i + 1}", "back": f"Meaning {base + i + 1}", "sheet": 1} for i in range(n)]}
    if "notes for gaps" in sys_:
        return {"topic": "Photosynthesis", "verdict": "Mostly complete.", "covered": ["Inputs"], "missing": [{"topic": "Calvin cycle", "why": "Core exam topic.", "add": "The Calvin cycle fixes CO2 into sugar."}], "unclear": []}
    if "briefing a tutor" in sys_:
        return {"summary": "A unit on photosynthesis and plant energy.", "topics": ["Light reactions", "Calvin cycle", "Chlorophyll"], "terms": ["chlorophyll", "Calvin cycle", "ATP", "NADPH"]}
    if "check a student's notes against the topics" in sys_:
        n = len(re.findall(r"^\d+\. ", user, re.M))
        return {"topics": [{"n": i, "status": ["covered", "partial", "missing"][(i - 1) % 3], "sheet": 1 if i % 3 != 0 else None, "hint": "" if i % 3 == 1 else "add more"} for i in range(1, n + 1)]}
    if "transcript of a class lecture" in sys_:
        return {"title": "Lecture on plants", "say": "Made notes from the lecture.", "blocks": [{"type": "heading", "text": "Main idea"}, {"type": "bullets", "items": ["Plants use light", "They make glucose"]}],
                "key_terms": [{"term": "Chlorophyll", "meaning": "Green pigment"}], "follow_up": ["Ask about the Calvin cycle"]}
    if "infographic" in sys_:
        return {"title": "Process", "kinds": ["process", "list", "cycle"], "nodes": [{"id": "a", "label": "Light", "icon": "☀️"}, {"id": "b", "label": "Water", "icon": "💧"}, {"id": "c", "label": "Glucose", "icon": "🍬"}]}
    if "scientific illustrator" in sys_:
        return {"title": "Thing", "drawing": '<circle cx="200" cy="200" r="150" fill="#cdf" stroke="#2B2B2B" stroke-width="3"/>', "parts": [{"label": f"Part {i}", "detail": "a part", "x": 120 + i * 50, "y": 200} for i in range(4)]}
    return {"ok": True}

def chat(messages, json_mode=False, temperature=0.4, max_tokens=None, timeout=None):
    first = messages[0].get("content"); text = first if isinstance(first, str) else json.dumps(first)
    if "Translate the student's notes" in text: return "అనువాదం: " + str(messages[-1]["content"])[:200]
    if "Transcribe" in text or "digitising" in text: return "<h2>Imported page</h2><p>Text read from the page.</p>"
    if "single word OK" in str(messages[-1].get("content")): return "OK"
    return "Your notes say plants make glucose from light [note:1]."

def stream_chat(messages, temperature=0.4, max_tokens=None):
    for w in "Your notes say photosynthesis turns light into glucose. In general, it happens in chloroplasts.".split(" "): time.sleep(0.02); yield w + " "

def install(app=None):
    from services import llm, gnani
    llm.chat_json, llm.chat, llm.stream_chat = chat_json, chat, stream_chat
    llm.check = lambda: {"ok": True, "model": "mock"}
    gnani.synthesize = lambda text, voice, model=None, language="auto", speed=1.0: _wav(min(3.0, 0.4 + len(text) / 60))
    def synth_stream(text, voice, model=None, language="auto", speed=1.0, rate=24000):
        pcm = _wav(min(3.0, 0.4 + len(text) / 60), rate)[44:]
        def gen():
            for i in range(0, len(pcm), 4800): time.sleep(0.02); yield pcm[i:i + 4800]
        return gen()
    gnani.synthesize_stream = synth_stream
    gnani.transcribe_full = lambda path, language_code, ctx=None: {"text": "Plants make glucose using sunlight and chlorophyll.", "language": "en-IN", "context_used": bool(ctx)}
    gnani.transcribe = lambda path, language_code: "Plants make glucose using sunlight and chlorophyll."
    import config
    if not config.GNANI_API_KEY: config.GNANI_API_KEY = "mock"
    print("  TEST MODE: AI and Gnani are mocked (NC_MOCK=1)")

def register_ws(sock):
    """Mock live captions: one caption for every ~3 s of audio received."""
    from routes.speech import closing
    @sock.route("/api/stt/stream")
    @closing
    def stt_stream(ws):
        try: start = json.loads(ws.receive(timeout=15) or "{}")
        except Exception: return
        ws.send(json.dumps({"type": "ready", "model": "prisma-v3.0", "language": start.get("language", "en-IN"), "keyterms": len(start.get("terms") or []), "topic": False}))
        frames, n = 0, 0
        while True:
            try: msg = ws.receive(timeout=30)
            except Exception: return
            if msg is None: continue
            if isinstance(msg, (bytes, bytearray)):
                frames += 1
                if frames % 94 == 0: n += 1; ws.send(json.dumps({"type": "transcript", "text": f"Live caption number {n} about plants and sunlight.", "language": "en-IN"}))
            elif json.loads(msg).get("type") == "stop":
                ws.send(json.dumps({"type": "transcript", "text": "Final caption.", "language": "en-IN"})); ws.send(json.dumps({"type": "closed"})); return
