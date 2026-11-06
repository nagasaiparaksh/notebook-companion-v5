"""Decides, for each thing the person says, whether it is note content (dictation), a command for the notebook, or a question for the Companion."""
import re
from flask import Blueprint, request, jsonify
from db import get_db
from services import llm, materials
bp = Blueprint("voice", __name__)
ACTIONS = {"new_sheet", "go_to_sheet", "toggle_sheet_panel", "format", "visualize", "rename_note", "new_note", "open_note", "go_home", "pin_note",
           "read_aloud", "stop_speaking", "stop_listening", "undo", "summarize", "open_companion", "close_companion", "study", "export", "import_notes", "compose", "open_materials", "lecture",
           "edit_text", "organize", "add_to_notes", "delete", "redo", "unsupported"}
NO_COMPOSE = ("study", "export", "import_notes", "edit_text", "organize", "add_to_notes", "read_aloud", "rename_note", "delete", "undo", "redo")
PROMPT = """You are the voice brain of a voice-controlled notebook. The person speaks continuously; every utterance has already been transcribed.
Decide what each utterance is, then return ONLY JSON: {"type":"dictate"|"command"|"question","action":str|null,"args":object,"text":str,"confidence":0..1}
- "dictate": the person is saying note content (lecture facts, ideas, to-dos, sentences to write down). DEFAULT. Put a lightly cleaned version in "text": fix punctuation and capitalisation, drop fillers (um, uh), turn spoken "new line"/"new paragraph" into \\n, "full stop"/"comma" into the symbols. Fix words that speech recognition clearly misheard when the SUBJECT VOCABULARY (from the course material) has the intended term, e.g. "are and ends" -> "RNNs", "back propagation" -> "backpropagation". Never change the meaning or add words. Imperative-sounding content that is part of what they are writing (e.g. "Draw a line between the two points to get the slope") is dictation.
- "command": the person is clearly instructing the notebook itself. Allowed actions and args:
  new_sheet {} | go_to_sheet {target:"next"|"previous"|"first"|"last"|<number>} | toggle_sheet_panel {} |
  format {style:"bold"|"italic"|"underline"|"heading"|"paragraph"|"bullets"|"numbered"} or {color:str} or {highlight:str} or {font_size:"bigger"|"smaller"|<number>} (acts on the selected text) |
  visualize {scope:"selection"|"sheet"|"topic", topic:str, kind:"process"|"cycle"|"hierarchy"|"mindmap"|"comparison"|"timeline"|"list"|"labelled"|""} (make a diagram/visual/flowchart/mind map; "topic" only when they name a subject to draw; kind "labelled" = a labelled picture/diagram of a thing with its parts named, e.g. the heart, a cell, a flower, a volcano) |
  rename_note {title} | new_note {title} | open_note {title} | go_home {} | pin_note {pinned:bool} | read_aloud {scope:"sheet"|"note"|"selection", language:"te-IN"|"hi-IN"|"ta-IN"|"kn-IN"|"ml-IN"|"mr-IN"|"bn-IN"|"gu-IN"|"pa-IN"|"" ("" = as written; a code when they ask to hear it in that language, e.g. "read this in Telugu")} | stop_speaking {} | stop_listening {} | undo {} |
  summarize {scope:"sheet"|"note", into:"panel"|"new_sheet"|"notes"} ("notes" = they want the summary written into the current sheet) | open_companion {} | close_companion {} |
  edit_text {what:"heading"|"text", target:str, replacement:str} (change words that ALREADY exist in the notebook: "replace the heading X with Y", "change the current heading to Y", "rename this heading to Y", "replace the word X with Y", "change photosynthesis to respiration". target = the existing words exactly as they appear in the notes (use the HEADINGS list in the context when it fits), or "" when they mean the current/this heading. replacement = the new wording only, without quotes or "a new heading saying") |
  organize {scope:"sheet"|"note"} (organize / tidy up / clean up / restructure / arrange the notes properly, remove repeated or overlapping points; "this sheet"/"this page" = sheet, "my notes"/"the notebook"/"everything" = note) |
  add_to_notes {} (put the Companion's last answer, summary or quiz into the notes: "add that to my notes", "put this answer in the notebook", "save that in my notes") |
  study {mode:"quiz"|"flashcards"|"gaps", scope:"note"|"sheet"} (quiz me / test me / make flashcards / what did I miss / what's missing from my notes) |
  compose {instruction:str} (the person asks YOU to write or create content in the notebook: put a heading, add a summary, make bullet points, add a small side heading, draw/put up a diagram of X, or several of these at once. Pass their whole request, cleaned of speech errors, as instruction) |
  export {format:"pdf"|"word"|"markdown"} (download / save / export the notebook) | import_notes {} (import a photo or PDF of notes)
  delete {what:"sheet"|"selection"|"picture"|"text"|"words"|"notebook", target:str, kind:"heading"|"paragraph"|"line"|"bullet"|"box"|""} (remove something):
    sheet: "delete this sheet" (target ""), "delete sheet 3" (target "3"), "delete the last sheet" (target "last");
    selection: "delete this" / "delete the selected text" / "remove that" while text is selected;
    picture: "delete this picture/image/diagram/visual" (target = words describing it, or "" for the selected/only one, or "last");
    text: a whole heading, paragraph, line, bullet point or Companion box: "delete the heading Speech Recognition" (kind heading, target "Speech Recognition"), "remove the paragraph about LSTMs" (kind paragraph, target "LSTMs"), "delete the last line" (kind line, target "last"), "delete this paragraph" (target "this"), "remove the summary box" (kind box);
    words: only some words inside a sentence: "delete the word basically", "remove 'very important'";
    notebook: "delete this whole notebook" (the app asks them to confirm). |
  redo {} (redo / bring back what undo removed) |
  open_materials {} (add / upload / show the course material, syllabus, slides or textbook for this notebook) |
  lecture {} (record the lecture / class, start lecture mode, take notes of the whole class) |
- Requests addressed to YOU are commands, even when long, polite, or mixed with subject words: sentences like "you can put the heading as...", "can you add a summary of...", "why don't you just put up a diagram of...", "please write a heading...", "make a small heading on the side saying..." are command compose. Telling you what to write is NOT dictation; dictation is the content itself (e.g. "RNNs keep a hidden state between steps").
- undo = "undo", "undo that", "take that back", "I didn't mean that", "cancel that", "go back". Deleting/removing something is delete, never dictation.
- Asking you to generate, create or prepare study material (practice / exam / situational questions with answers, worked examples, code examples, notes or a summary on a topic) is command compose with the WHOLE request as instruction, even when it starts with background such as "I have an exam tomorrow on Spring Boot ..." and even when it says "help me". It is not a question and not dictation.
- Asking to change, replace, rename or fix text or a heading that is already in the notes is edit_text, never compose and never dictation. Asking to organize/tidy the notes is organize, never compose.
- read_aloud scope "selection" when they say "read this", "read the selected text", "read that out" while text is selected.
- "question": the person is asking the AI companion something (explain, what is, why, quiz me, compare, what did I write) -> put the question in "text".
Be conservative with commands: a command must be addressed to the notebook/assistant, not content. If unsure whether it is a command, choose "dictate" and give a low confidence.
Examples: "add a new sheet" -> command new_sheet. "go to sheet three" -> command go_to_sheet 3. "make the selected text red" -> command format color red. "turn this into a flowchart" -> command visualize scope selection kind process.
"show me how an amoeba looks like" -> command visualize scope topic topic "amoeba". "draw a labelled diagram of the heart" -> command visualize scope topic topic "heart" kind labelled. "make a labelled diagram of this" (text selected) -> command visualize scope selection kind labelled. "the mitochondria is the powerhouse of the cell" -> dictate. "what's the difference between RNN and LSTM" -> question. "explain this sheet" -> question. "you can put the heading as speech recognition and make another small heading on the side saying unit one RNNs, and why don't you just put up a summary and a diagram of RNN and its architecture" -> command compose with that whole request as instruction. "add a summary of this sheet" -> command compose. "quiz me on this" -> command study mode quiz scope note. "make flashcards from this sheet" -> command study mode flashcards scope sheet. "what did I miss?" -> command study mode gaps. "export this as a PDF" -> command export format pdf.
"replace the heading speech recognition with speech processing" -> command edit_text what heading target "speech recognition" replacement "Speech Processing". "change the current heading to Neural Networks" -> command edit_text what heading target "" replacement "Neural Networks". "replace RNN with recurrent neural network" -> command edit_text what text target "RNN" replacement "recurrent neural network". "organize my notes properly and remove the overlaps" -> command organize scope note. "tidy up this sheet" -> command organize scope sheet. "add that summary to my notes" -> command add_to_notes. "summarize this sheet and add it to my notes" -> command summarize scope sheet into notes. "read the selected text" -> command read_aloud scope selection. "delete this sheet" -> command delete what sheet target "". "remove the heading speech recognition" -> command delete what text kind heading target "speech recognition". "delete the word basically" -> command delete what words target "basically". "I didn't mean that" -> command undo."""

_LEAD = r"(?:(?:please|just|ok|okay|so|and|now|hey)[, ]+)*"
_STUDY = re.compile(r"\b(generat\w*|creat\w*|prepar\w*|writ\w*|mak\w*|giv\w*|set|draft|come up with|help me)\b[^.?!]{0,80}?\b(\d+|some|a few|few|several|three|four|five|ten)?\s*(?:[\w-]+\s+){0,3}?(questions?|answers?|examples?|exercises?|problems?|mcqs?|flashcards?|code|programs?|snippets?|diagrams?|flowcharts?|flow charts?|mind ?maps?|charts?|visuals?|infographics?|pictures?|summary|summaries|notes|headings?|bullet points?|tables?|timelines?)\b", re.I)
def _request_part(t):
    """Drop misheard words before the actual request: "Back to the Hollywood flea markets. Listen to me. I am asking you to generate a diagram of X" -> from the request on."""
    parts = re.split(r"(?<=[.!?])\s+", t.strip())
    for i, s in enumerate(parts):
        if _STUDY.search(s) or _looks_compose(s): return " ".join(parts[i:])
    return t
_EDIT_VERBS = r"\b(replace|change|rename|edit|update|correct|fix|delete|remove|erase|undo|redo|organi[sz]e|reorgani[sz]e|tidy|clean up|restructure|rearrange|reorder|sort out|read)\b"
def _looks_compose(t):
    """A request addressed to the notebook that asks for written/visual content to be made (heading, summary, diagram...)."""
    if re.search(_EDIT_VERBS, t, re.I): return False      # changing / organizing / reading existing notes is not writing new content
    asks = re.match(_LEAD + r"(?:(?:can|could|would) you\b|you (?:can|could|should)\b|i (?:want|need) you to\b|why don'?t you\b|let'?s\b|(?:put|add|write|make|create|insert|draw|give me|type|put up)\b)", t, re.I)
    return bool(asks and len(t.split()) >= 4 and re.search(r"\b(heading|title|summary|summari[sz]e|diagram|bullets?|key points|table|chart|outline|side heading|sub ?heading)\b", t, re.I))

_Q = r"[\"“”'‘’]?"
_LANG_CODE = {"telugu": "te-IN", "hindi": "hi-IN", "tamil": "ta-IN", "kannada": "kn-IN", "malayalam": "ml-IN", "marathi": "mr-IN", "bengali": "bn-IN", "gujarati": "gu-IN", "punjabi": "pa-IN"}
# words that can start an instruction or a question; anything else that isn't addressed to the app is note content
_CUE = set("""can could would will please hey ok okay add put make create write insert draw show turn convert change replace rename delete remove erase undo redo
go open close read stop start quiz test summarize summarise explain what why how who when where which whats tell give help organize organise tidy clean export save
download import record highlight bold underline italic select new next previous let lets don't dont do does did is are am was were should shall may might yes no""".split())
def _plain_dictation(t):
    """True for ordinary note content, so it can be written immediately without asking the AI (which takes seconds)."""
    l = t.strip().lower(); w = re.findall(r"[a-z']+", l)
    if not w or "?" in l or len(w) < 3: return False
    if w[0] in _CUE or (w[0] == "i" and len(w) > 1 and w[1] in ("want", "need", "would", "wanna", "didn't", "didnt", "meant")): return False
    if re.search(r"\b(you|your|this sheet|this page|this note|the sheet|the page|the notebook|my notes|the heading|the title|companion|notebook)\b", l): return False
    # a request can start anywhere: "I have an exam tomorrow ... so help me by generating some questions and answers"
    if re.search(r"\b(help me|help us|for me|give me|show me|tell me|teach me|make me|let me know|i want|i need|i'd like|i would like|please|generate|generating|"
                 r"create|write (?:me |down )?(?:some|a few|\d+)|questions? (?:and|with) (?:its |their |the )?answers?|quiz|explain|summari[sz]e|prepare|draft|suggest|recommend)\b", l): return False
    return len(w) <= 60          # a very long utterance is more likely a mixed request: let the AI decide
def _tidy(t):
    """The light clean-up the AI used to do for dictation: fillers out, spoken punctuation in."""
    t = re.sub(r"\b(um+|uh+|erm+|hmm+|uhm+)\b[,.]?\s*", "", t, flags=re.I)
    t = re.sub(r"\s*\b(new paragraph|new line|next line)\b[,.]?\s*", "\n", t, flags=re.I)
    t = re.sub(r"\s*\bfull stop\b", ".", t, flags=re.I); t = re.sub(r"\s*\bcomma\b", ",", t, flags=re.I)
    t = re.sub(r"[ \t]{2,}", " ", t).strip()
    return t[:1].upper() + t[1:] if t else t
def _fallback(text, ctx, safety=False):
    """No AI available: only unmistakable, fully anchored commands; everything else is dictation.
    safety=True when used to double-check an AI 'dictate' verdict: skip patterns that could also be note content."""
    t = text.strip(); l = re.sub(r"[.!?,]+$", "", t.lower()); sel = bool(ctx.get("selection"))
    def cmd(a, **args): return {"type": "command", "action": a, "args": args, "text": t, "confidence": .9, "fallback": True}
    nums = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
    if re.fullmatch(r"(add|create|insert|start|make)( a)?( new)? (sheet|page)", l): return cmd("new_sheet")
    m = re.fullmatch(r"(?:go to|open|show) (?:sheet|page) (\w+)", l)
    if m: n = nums.get(m.group(1)) or (int(m.group(1)) if m.group(1).isdigit() else None); return cmd("go_to_sheet", target=n) if n else None
    if re.fullmatch(r"(next|previous|first|last) (sheet|page)", l): return cmd("go_to_sheet", target=l.split()[0])
    if re.fullmatch(r"(stop listening|stop voice mode|turn off voice mode|stop the microphone)", l): return cmd("stop_listening")
    if re.fullmatch(r"(stop reading|stop speaking|be quiet|stop talking)", l): return cmd("stop_speaking")
    if re.fullmatch(r"(?:please )?(undo|undo (?:that|it|this|last|the last (?:change|thing|step))|take (?:that|it) back|i didn'?t (?:mean|want) (?:that|this|to do that)|cancel that|go back(?: one step)?)", l): return cmd("undo")
    if re.fullmatch(r"(?:please )?(redo|redo (?:that|it)|bring (?:that|it) back|undo (?:the|that) undo)", l): return cmd("redo")
    D = r"(?:please |can you |could you )?(?:delete|remove|erase|get rid of)"
    m = re.fullmatch(D + r" (?:this|the current|current|the|that) (?:whole |entire )?(?:notebook|note)", l)
    if m: return cmd("delete", what="notebook", target="", kind="")
    m = re.fullmatch(D + r" (?:(this|the current|current|that) (?:sheet|page)|(?:the )?(last|first|next|previous) (?:sheet|page)|(?:sheet|page) (?:number )?(\w+))", l)
    if m:
        n = m.group(3); n = str(nums.get(n, n)) if n else (m.group(2) or "")
        return cmd("delete", what="sheet", target=n, kind="")
    if re.fullmatch(D + r" (?:this|that|it|the selected text|the selection|selected text|what i (?:selected|highlighted))", l):
        if sel: return cmd("delete", what="selection", target="", kind="")
        if ctx.get("object_selected"): return cmd("delete", what="picture", target="", kind="")
        return cmd("unsupported", message="Select the text or click the picture you want to delete, then say “delete this”.")
    m = re.fullmatch(D + r" (?:this|that|the|the selected|the last|my) (picture|image|photo|diagram|visual|drawing|figure|flowchart|chart)(?: (?:of|about|showing|called) (.+))?", l)
    if m: return cmd("delete", what="picture", target=(m.group(2) or ("last" if "last" in l else "")).strip(), kind="")
    m = re.fullmatch(D + r" (?:the |this |that |my )?(?:(last|first) )?(heading|title|paragraph|line|sentence|bullet(?: point)?|point|note box|summary box|box|companion box)(?:s)?(?: (?:about|on|called|named|saying|that says|with|which says))? ?(.*)", t.rstrip(".!?"), re.I)
    if m:
        kind = {"title": "heading", "sentence": "line", "point": "bullet", "bullet point": "bullet"}.get(m.group(2).lower(), m.group(2).lower()); kind = "box" if "box" in kind else kind
        tgt = (m.group(3) or "").strip().strip("\"“”'‘’") or (m.group(1).lower() if m.group(1) else ("this" if re.search(r"\b(this|that)\b", l.split()[1] if len(l.split()) > 1 else "") else ""))
        return cmd("delete", what="text", target=tgt, kind=kind)
    if not safety:
        m = re.fullmatch(D + r" (?:the (?:word|words|phrase|text) " + _Q + r"(.+?)" + _Q + r"|[\"“'‘](.+?)[\"”'’])(?: from (?:this|the) (?:sentence|line|sheet|page|paragraph))?[.!]?", t, re.I)
        if m and len((m.group(1) or m.group(2)).split()) <= 6: return cmd("delete", what="words", target=(m.group(1) or m.group(2)).strip(), kind="")
    m = re.fullmatch(r"(?:(?:please|can you|could you|will you|now|ok|okay|hey)[, ]+)*read(?: out| aloud)? (?:this|the|my|whole|entire|this whole|the whole|the current|all)? ?(sheet|page|note|notes|notebook|everything|it all)(?: aloud| out loud| out| to me)?(?: (?:please|for me))?(?: in (telugu|hindi|tamil|kannada|malayalam|marathi|bengali|gujarati|punjabi))?(?: please)?", l)
    if m: return cmd("read_aloud", scope="note" if m.group(1) in ("note", "notes", "notebook", "everything", "it all") else "sheet", language=_LANG_CODE.get(m.group(2) or "", ""))
    if re.fullmatch(r"(?:please )?read (?:out )?(?:this|that|it|the selected text|the selection|selected text|what i (?:selected|highlighted))(?: aloud| out loud| out)?(?: for me)?", l):
        return cmd("read_aloud", scope="selection" if sel else "sheet")
    m = re.fullmatch(r"(?:please |can you |could you )?(?:replace|change|rename|update|edit)\s+(?:the\s+|this\s+|my\s+)?(?:current\s+|first\s+|main\s+|top\s+|existing\s+|particular\s+)?head(?:ing|in)"
                     r"(?:\s+(?:that says|saying|called|named))?(?:\s+" + _Q + r"(.+?)" + _Q + r")?\s+(?:with|to|as|into|by)\s+(?:(?:a\s+)?new\s+(?:one|heading)\s+(?:saying|called|that says|as)?\s*)?" + _Q + r"(.+?)" + _Q + r"[.!]?", t, re.I)
    if m: return cmd("edit_text", what="heading", target=(m.group(1) or "").strip(), replacement=m.group(2).strip())
    if not safety:
        m = re.fullmatch(r"(?:please )?replace\s+(?:the (?:word|words|text|phrase)\s+)?" + _Q + r"(.+?)" + _Q + r"\s+with\s+" + _Q + r"(.+?)" + _Q + r"[.!]?", t, re.I)
        if m: return cmd("edit_text", what="text", target=m.group(1).strip(), replacement=m.group(2).strip())
    m = re.fullmatch(r"(?:please |can you |could you )?(?:organi[sz]e|re-?organi[sz]e|tidy up|clean up|restructure|sort out|arrange)(?: (?:this|the|my|all(?: of)?(?: my| the)?))?(?: (sheet|page|notes?|notebook|everything))?(?: more)?(?: properly| better| neatly)?(?:,? (?:and )?(?:remove|removing|without) (?:the )?(?:overlaps?|repeats?|repetitions?|duplicates?)(?: etc)*)?", l)
    if m: return cmd("organize", scope="sheet" if (m.group(1) or "sheet") in ("sheet", "page") else "note")
    if re.fullmatch(r"(?:please )?(?:start |open |turn on )?(?:(?:record|recording) (?:the |this |my )?(?:lecture|class)|lecture mode)(?: mode)?(?: please)?", l): return cmd("lecture")
    if re.fullmatch(r"(?:please )?(?:add|upload|attach|open|show)(?: me)? (?:the |my |some )?(?:course )?(?:material|materials|syllabus|slides|textbook|reference material|study material)(?: for this notebook)?", l): return cmd("open_materials")
    if re.fullmatch(r"(?:please )?(?:add|put|save|insert|paste) (?:that|this|it|the (?:answer|reply|summary|quiz|explanation))(?: answer| reply| summary)? (?:in|into|to|on) (?:my|the|this) (?:notes?|notebook|sheet|page)", l): return cmd("add_to_notes")
    m = re.fullmatch(r"(?:rename (?:this )?(?:note|notebook) to|call this (?:note|notebook)) (.+?)[.!?]?", t, re.I)
    if m: return cmd("rename_note", title=m.group(1).strip())
    if sel and re.fullmatch(r"(?:make|set) (?:this|that|it|the selected text) (bold|italic|underlined)", l): return cmd("format", style={"underlined": "underline"}.get(l.split()[-1], l.split()[-1]))
    m = re.match(r"(?:please )?(?:draw|make|create|show|generate|give)(?: me)?(?: a| an| the)? (?:labell?ed|annotated) (?:diagram|picture|drawing|image|figure|illustration)(?: of| for)?(?: (?:a|an|the))? ?(.*)", l)
    if m: subj = m.group(1).strip(); return cmd("visualize", scope="topic" if subj and not re.fullmatch(r"(this|that|it|these|the selection|the selected text)", subj) else ("selection" if sel else "sheet"), topic=subj if not re.fullmatch(r"(this|that|it|these|the selection|the selected text)", subj) else "", kind="labelled")
    lead = r"(?:(?:please|just|ok|okay|so|and|now|hey)[, ]+)*"
    if _looks_compose(t) or _STUDY.search(t): return cmd("compose", instruction=_request_part(t))
    if re.fullmatch(r"(please )?(quiz me|test me|give me a quiz|start (a |the )?quiz|quiz me on (this|my notes|this sheet|this note(book)?))", l): return cmd("study", mode="quiz", scope="sheet" if "sheet" in l else "note")
    if re.fullmatch(r"(please )?(make|create|give me|show|open)( me)?( some)? (flash ?cards)( from (this|my notes|this sheet|this note(book)?))?", l): return cmd("study", mode="flashcards", scope="sheet" if "sheet" in l else "note")
    if re.fullmatch(r"(what did i (miss|forget)|what am i missing|what('s| is) missing( from (my|this) notes?)?|check my notes for gaps)", l): return cmd("study", mode="gaps", scope="note")
    m = re.fullmatch(r"(?:please )?(?:export|download|save)(?: this| my)?(?: note(?:book)?)?(?: as| to)?(?: a| an)? (pdf|word|docx|markdown|md)(?: file)?", l)
    if m: return cmd("export", format={"docx": "word", "md": "markdown"}.get(m.group(1), m.group(1)))
    if re.search(r"\b(flowchart|mind ?map|timeline|diagram|visual|infographic)\b", l) and re.match(r"(please )?(make|create|turn|convert|draw|generate|show)", l):
        kind = "process" if "flowchart" in l else "mindmap" if re.search("mind ?map", l) else "timeline" if "timeline" in l else ""
        m = re.search(r"\b(?:of|for|about|showing|on) (?:the |a |an |how )?(.+?)[.!?]?$", l); topic = (m.group(1).strip() if m else "")
        if topic and not re.fullmatch(r"(this|that|it|these|this sheet|the sheet|this page|the selection|the selected text|my notes)", topic):
            return cmd("visualize", scope="topic", topic=topic, kind=kind)         # "draw a flowchart of the water cycle"
        return cmd("visualize", scope="selection" if sel else "sheet", topic="", kind=kind)
    if re.match(r"(what|why|how|explain|tell me|quiz me|summari[sz]e)\b", l) and len(l.split()) > 2: return {"type": "question", "action": None, "args": {}, "text": t, "confidence": .6, "fallback": True}
    return None

@bp.post("/voice/interpret")
def interpret():
    d = request.json or {}; text = (d.get("text") or "").strip(); ctx = d.get("context") or {}
    if not text: return jsonify(error="No speech to interpret"), 400
    context = (f"Notebook title: {ctx.get('title', '')}\nSheet {ctx.get('sheet_index', 1)} of {ctx.get('sheet_count', 1)}\n"
               f"Selected text: {str(ctx.get('selection', ''))[:300] or '(none)'}\nEnd of current sheet: {str(ctx.get('sheet_tail', ''))[-300:] or '(empty)'}\n"
               f"Language: {ctx.get('language', 'en-IN')}\n"
               f"HEADINGS on this sheet: {' | '.join(str(h)[:80] for h in (ctx.get('headings') or [])[:12]) or '(none)'}\n"
               f"A picture/visual is selected: {'yes' if ctx.get('object_selected') else 'no'}")
    # fast path: unmistakable, fully anchored commands ("undo", "new sheet", "delete this sheet", "put a heading ...") need no AI round-trip
    fb = _fallback(text, ctx, safety=True)
    if fb and fb["type"] == "command":
        fb.pop("fallback", None); fb["fast"] = True; return jsonify(fb)
    if _plain_dictation(text):                     # ordinary note content ("the Calvin cycle happens in the stroma") is written at once
        return jsonify({"type": "dictate", "action": None, "args": {}, "text": _tidy(text), "confidence": .8, "fast": True})
    vocab = materials.vocabulary(get_db(), ctx.get("note_id")) if ctx.get("note_id") else []
    own = [str(t)[:40] for t in (ctx.get("terms") or [])[:40] if str(t).strip()]       # the notebook's own acronyms / names help even without course material
    if vocab or own: context += "\nSUBJECT VOCABULARY (spell these terms exactly like this): " + ", ".join(dict.fromkeys(vocab + own))
    try:
        r = llm.chat_json([{"role": "system", "content": PROMPT}, {"role": "user", "content": f"CONTEXT\n{context}\n\nUTTERANCE\n{text[:1500]}"}], max_tokens=400, timeout=(5, 12))
    except Exception as e:
        out = _fallback(text, ctx) or {"type": "dictate", "action": None, "args": {}, "text": text, "confidence": .5, "fallback": True}
        out["ai_error"] = str(e)[:200]; return jsonify(out)
    typ = r.get("type") if r.get("type") in ("dictate", "command", "question") else "dictate"
    action, args = r.get("action"), r.get("args") if isinstance(r.get("args"), dict) else {}
    try: conf = float(r.get("confidence", .7))
    except Exception: conf = .7
    out = {"type": typ, "action": action, "args": args, "text": str(r.get("text") or text), "confidence": conf}
    if _looks_compose(text) and action != "compose" and not (typ == "command" and action in NO_COMPOSE):
        out.update(type="command", action="compose", args={"instruction": text}, text=text, confidence=.9, overridden=True)   # safety net: never dictate an instruction
    if typ == "command" and (action not in ACTIONS or conf < .55): out.update(type="dictate", action=None, args={}, text=text, uncertain=True)
    if out["type"] == "dictate":                     # safety net: unmistakable, fully anchored commands ("undo", "new sheet") are never dictated
        fb = _fallback(text, ctx, safety=True)
        if fb and fb["type"] == "command": out.update(fb); out["overridden"] = True
    if out["type"] == "command" and out["action"] == "edit_text":
        a = out["args"]; a["what"] = "text" if a.get("what") == "text" else "heading"
        a["target"] = str(a.get("target") or "").strip().strip("\"“”'‘’")[:200]; a["replacement"] = str(a.get("replacement") or "").strip().strip("\"“”'‘’")[:300]
        if not a["replacement"]: out.update(type="command", action="unsupported", args={"message": "What should the new wording be? Try: “replace the heading X with Y”."})
    if out["type"] == "command" and out["action"] == "delete":
        a = out["args"]; a["what"] = a.get("what") if a.get("what") in ("sheet", "selection", "picture", "text", "words", "notebook") else ("selection" if ctx.get("selection") else "text")
        a["target"] = str(a.get("target") if a.get("target") is not None else "").strip().strip("\"“”'‘’")[:200]; a["kind"] = a.get("kind") if a.get("kind") in ("heading", "paragraph", "line", "bullet", "box") else ""
    if out["type"] == "dictate" and not out["text"].strip(): out["text"] = text
    return jsonify(out)


# ---------------------------------------------------------------- compose: "put a heading ..., a summary and a diagram of ..."
from routes.study import _notebook
COMPOSE = """You are the writing hand of a voice-controlled notebook. The student SPOKE an instruction (transcribed, so it may contain small speech-recognition errors, filler or run-on phrasing). Plan exactly what to put on the current sheet. Return ONLY JSON:
{"say":str (<=20 words, past tense: what you added),
 "blocks":[ {"type":"heading","text":str(<=8 words),"tag":str(optional, <=6 words: a SMALL second heading shown on the same line at the right edge, e.g. a unit or topic label)}
  | {"type":"subheading","text":str(<=10 words)} | {"type":"paragraph","text":str} | {"type":"bullets","items":[str]} | {"type":"numbered","items":[str]}
  | {"type":"question","text":str (one practice / exam / situational question, starting "Q1.", "Q2." ...)} | {"type":"code","lang":str (e.g. "java","xml","properties","python","sql","bash"),"text":str (the code exactly as it should be typed, with real newlines and indentation)}
  | {"type":"visual","mode":"infographic"|"labelled","topic":str,"kind":"process"|"cycle"|"hierarchy"|"mindmap"|"comparison"|"timeline"|"list"|""} ]}
Rules:
- Do EXACTLY what was asked, in the order asked, and nothing else. Fix speech errors ("are n n" -> "RNN", "speech recognition" is a heading text, not a command). Never remove or rewrite existing notes.
- Facts the student states about their class ("today we learnt about RNNs", "unit one") are context for what to write or for a label; do not paste them back as sentences unless asked.
- "Heading ... and another small heading on the side saying X" = ONE heading block with "tag": X.
- A summary = one short intro sentence (paragraph block) then a bullets block of 4-7 points (each <=22 words), accurate and textbook-level. Use the NOTEBOOK CONTENT when it covers the topic, then the COURSE MATERIAL (when given it is the authoritative source, and its terms are the ones to use); otherwise your own accurate knowledge. Never invent what the class covered.
- A diagram/visual of a concept, algorithm, model architecture, process or system = mode "infographic" (kind: architecture or data flow = "process" or "hierarchy", repeating loop = "cycle"). Use "labelled" only for a physical thing with named parts (heart, cell, eye, circuit, plant...). topic = a specific description of what to draw, e.g. "RNN architecture: input, hidden state with a recurrent loop, output".
- STUDY MATERIAL: when they ask you to generate / prepare practice, exam or situational questions (with answers), worked examples or code, write it properly: for each one a "question" block with a realistic scenario, then the answer as paragraph / bullets, plus "code" blocks whenever the subject is programming (complete, correct, exam-sized code that a student could write by hand, with short comments). Give exactly the number they asked for (default 4). Cover the topics they list or that the NOTEBOOK CONTENT / COURSE MATERIAL covers, in that order. Start with a heading naming the topic. Background they give ("I have an exam tomorrow", what they were told to study) is context: use it to choose topics, never paste it back.
- Put visual blocks LAST. At most 10 blocks (up to 45 for study material) and 2 visuals. Write in the language the student spoke.
- If the request is impossible or too unclear, return {"say":"<one short question asking what they want>","blocks":[]}."""

def _blocks(raw):
    out, vis = [], 0
    for b in (raw or [])[:50]:
        if not isinstance(b, dict): continue
        t = b.get("type"); s = lambda v, n: str(v or "").strip()[:n]
        if t in ("heading", "subheading", "paragraph") and s(b.get("text"), 5):
            blk = {"type": t, "text": s(b.get("text"), 1500 if t == "paragraph" else 160)}
            if t == "heading" and s(b.get("tag"), 2): blk["tag"] = s(b.get("tag"), 40)
            out.append(blk)
        elif t == "question" and s(b.get("text"), 5): out.append({"type": "question", "text": s(b.get("text"), 900)})
        elif t == "code" and str(b.get("text") or "").strip():
            out.append({"type": "code", "lang": re.sub(r"[^\w+#.-]", "", str(b.get("lang") or ""))[:20], "text": str(b["text"]).rstrip()[:4000]})
        elif t in ("bullets", "numbered"):
            items = [s(i, 400) for i in (b.get("items") or []) if s(i, 2)][:15]
            if items: out.append({"type": t, "items": items})
        elif t == "visual" and s(b.get("topic"), 3) and vis < 2:
            vis += 1; kind = b.get("kind") if b.get("kind") in ("process", "cycle", "hierarchy", "mindmap", "comparison", "timeline", "list") else ""
            out.append({"type": "visual", "mode": "labelled" if b.get("mode") == "labelled" else "infographic", "topic": s(b.get("topic"), 200), "kind": kind})
    out.sort(key=lambda b: b["type"] == "visual")      # visuals always come last
    return out

@bp.post("/voice/compose")
def compose():
    d = request.json or {}; ins = (d.get("instruction") or "").strip()[:4000]; study = bool(_STUDY.search(ins))
    if not ins: return jsonify(error="No instruction."), 400
    title, nb = (None, "")
    if d.get("note_id"):
        try: title, nb = _notebook(d["note_id"], None, 6000)
        except Exception: pass
    ctx = (f"Notebook title: {title or ''}\nCurrent sheet: {d.get('sheet_index', 1)} of {d.get('sheet_count', 1)}\n"
           f"Selected text: {str(d.get('selection') or '')[:300] or '(none)'}\nEnd of the current sheet: {str(d.get('sheet_tail') or '')[-400:] or '(empty)'}")
    try:
        mat = materials.context(get_db(), d.get("note_id"), ins, k=6, limit=5000) if d.get("note_id") else ""
        r = llm.chat_json([{"role": "system", "content": COMPOSE}, {"role": "user", "content": f"INSTRUCTION (spoken)\n{ins}\n\nCONTEXT\n{ctx}\n\nNOTEBOOK CONTENT\n{(nb or '(empty)')[:6000]}" + (f"\n\n{mat}" if mat else "")}], max_tokens=8000 if study else 2500, timeout=(6, 120 if study else 60))
    except Exception as e: return jsonify(error="I need the AI to plan that, and it isn't answering right now: " + str(e)[:160]), 503
    blocks = _blocks(r.get("blocks"))
    return jsonify({"say": str(r.get("say") or "").strip()[:200], "blocks": blocks})


# ---------------------------------------------------------------- organize: "organize my notes properly, remove the overlaps"
ORGANIZE = """You tidy up a student's notebook. You get the text of one or more sheets as a simple outline:
"## text" = heading ("{tag: X}" after it = a small side label on the same line), "- text" = bullet, "1. text" = numbered item, any other line = a paragraph, "[[box N]]" = a saved Companion box (keep it, never open or edit it).
Return ONLY JSON: {"say":str (<=25 words, past tense: what you changed), "sheets":[{"sheet":number,"blocks":[...]}]}
Block types: {"type":"heading","text":str,"tag":str(optional)} | {"type":"subheading","text":str} | {"type":"paragraph","text":str} | {"type":"bullets","items":[str]} | {"type":"numbered","items":[str]} | {"type":"keep","ref":"box N"}
Rules:
- Keep EVERY fact, definition, formula, example, number and name the student wrote. Never add new information, never change the meaning, never translate.
- Remove overlaps: when the same point appears more than once (on one sheet or across sheets), keep it ONCE, in the most complete wording, merging any extra detail from the copies.
- Group related points under clear headings in a logical order (what it is -> how it works -> examples -> pros/cons ...). Keep the student's headings when they fit (with their tag); add a short heading only when it clearly helps.
- Split run-on dictation into short paragraphs or bullet lists and fix obvious speech-recognition slips and punctuation. Copy any line that needs no change EXACTLY, character for character.
- Return one entry for EVERY sheet you were given, with the same sheet numbers. Keep each sheet's content on that sheet (its pictures stay there); only drop a repeat from a later sheet when an earlier sheet already has it.
- Every [[box N]] appears exactly once, as {"type":"keep","ref":"box N"}, where it fits best on its own sheet.
- Write in the language of the notes."""

@bp.post("/voice/organize")
def organize():
    d = request.json or {}; given = [s for s in (d.get("sheets") or []) if isinstance(s, dict) and isinstance(s.get("sheet"), int)][:40]
    outline = "\n\n".join(f"=== Sheet {s['sheet']} ===\n{str(s.get('outline') or '').strip() or '(empty)'}" for s in given)
    words = len(re.sub(r"\[\[box \d+\]\]|=== Sheet \d+ ===|\(empty\)", " ", outline).split())
    if words < 12: return jsonify(error="There isn't enough text here to organize yet."), 400
    if len(outline) > 18000: return jsonify(error="That's a lot of notes to reorganize at once. Try “organize this sheet” on one sheet at a time."), 400
    try:
        vocab = materials.vocabulary(get_db(), d.get("note_id")) if d.get("note_id") else []
        voc = f"SUBJECT VOCABULARY from the course material (use it only to fix misspelled or misheard terms; add nothing): {', '.join(vocab)}\n" if vocab else ""
        r = llm.chat_json([{"role": "system", "content": ORGANIZE}, {"role": "user", "content": f"NOTEBOOK TITLE: {str(d.get('title') or '')[:120]}\n{voc}\n{outline}"}], max_tokens=8000, timeout=(6, 90))
    except Exception as e: return jsonify(error="I need the AI to reorganize notes, and it isn't answering right now: " + str(e)[:160]), 503
    want = {s["sheet"] for s in given}; out = []
    for s in (r.get("sheets") or []):
        if not isinstance(s, dict) or s.get("sheet") not in want or any(o["sheet"] == s["sheet"] for o in out): continue
        blocks = []
        for b in (s.get("blocks") or [])[:60]:
            if isinstance(b, dict) and b.get("type") == "keep" and re.fullmatch(r"box \d+", str(b.get("ref") or "").strip()): blocks.append({"type": "keep", "ref": str(b["ref"]).strip()})
            else: blocks += _blocks([b])
        out.append({"sheet": s["sheet"], "blocks": [b for b in blocks if b["type"] != "visual"]})
    if not out: return jsonify(error="The AI's answer wasn't usable. Please try again."), 503
    # safety net: tidying removes repeats, it must never quietly throw notes away
    kept = sum(len(" ".join([b.get("text", "")] + b.get("items", [])).split()) for s in out for b in s["blocks"])
    if kept < words * 0.45: return jsonify(error=f"The tidy-up would have dropped too much of your writing ({kept} of {words} words kept), so I left your notes as they were. Try one sheet at a time."), 422
    return jsonify({"say": str(r.get("say") or "").strip()[:200], "sheets": out})
