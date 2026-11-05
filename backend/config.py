import os
from dotenv import load_dotenv
load_dotenv()
def env(k, d=""): return os.getenv(k, d).strip()
GNANI_API_KEY = env("GNANI_API_KEY")
GNANI_STT_URL = env("GNANI_STT_URL", "https://api.vachana.ai/stt/v3")
GNANI_TTS_URL = env("GNANI_TTS_URL", "https://api.vachana.ai/api/v1/tts/inference")
GNANI_TTS_MODEL = env("GNANI_TTS_MODEL", "timbre-v3.0")
LLM_BASE_URL, LLM_API_KEY, LLM_MODEL = env("LLM_BASE_URL"), env("LLM_API_KEY"), env("LLM_MODEL")
LLM_FALLBACK_MODEL = env("LLM_FALLBACK_MODEL", "")
# Optional backup AI provider (any OpenAI-compatible API), used automatically when the main one is rate-limited or down.
# Groq:      LLM2_BASE_URL=https://api.groq.com/openai/v1   LLM2_MODEL=llama-3.3-70b-versatile
# Cerebras:  LLM2_BASE_URL=https://api.cerebras.ai/v1       LLM2_MODEL=gpt-oss-120b
LLM2_BASE_URL, LLM2_API_KEY, LLM2_MODEL = env("LLM2_BASE_URL"), env("LLM2_API_KEY"), env("LLM2_MODEL")
LLM_REASONING_EFFORT = env("LLM_REASONING_EFFORT", "none")  # "none" disables Gemini 2.5 thinking: much faster
EMBED_BASE_URL = env("EMBED_BASE_URL") or LLM_BASE_URL
EMBED_API_KEY = env("EMBED_API_KEY") or LLM_API_KEY
EMBED_MODEL = env("EMBED_MODEL")
DATABASE_PATH = env("DATABASE_PATH", "notes.db")
# What the person speaks. Gnani Prisma v3.0 understands all ten languages, mixes of up to four (code-mixed speech, English terms kept
# in Latin script) and automatic detection. https://docs.gnani.ai/api/STT/languages.md
_L = [("te-IN", "Telugu"), ("hi-IN", "Hindi"), ("ta-IN", "Tamil"), ("kn-IN", "Kannada"), ("ml-IN", "Malayalam"), ("mr-IN", "Marathi"), ("bn-IN", "Bengali"), ("gu-IN", "Gujarati"), ("pa-IN", "Punjabi")]
LANGUAGES = ([{"code": "en-IN", "name": "English (India)"}] + [{"code": f"{c},en-IN", "name": f"{n} + English (mixed)"} for c, n in _L]
             + [{"code": c, "name": n} for c, n in _L] + [{"code": "indic-auto", "name": "Any Indian language (auto-detect)"}])
# Official catalog: https://docs.gnani.ai/api/TTS/available-voices.md  (voices are NOT shared between models)
def _v(rows): return [dict(name=n, gender=g, lang=l, desc=d) for n, g, l, d in rows]
CATALOG = {
 "timbre-v3.0": _v([("Shivani","Female","All 10","Warm, patient customer support"),("Lakshmi","Female","All 10","Expressive, warm storytelling"),("Vasudha","Female","All 10","Expressive, composed narration"),
   ("Kalpana","Female","All 10","Empathetic, composed care"),("Chetana","Female","All 10","Gentle, empathetic service"),("Riyaa","Female","All 10","Confident, lively"),("Tarika","Female","All 10","Warm, reassuring"),
   ("Avinash","Male","All 10","Professional, firm"),("Shubham","Male","All 10","Energetic"),("Prakash","Male","All 10","Steady, deliberate"),("Devansh","Male","All 10","Energetic, young"),
   ("Yashraj","Male","All 10","Warm narrative, e-learning"),("Harshad","Male","All 10","Professional, firm")]),
 "timbre-v2.5": _v([("Kaveri","Female","English","Firm customer support"),("Devika","Female","English","Authoritative support"),("Trupti","Female","English","Upbeat, articulate"),("Girish","Male","English","Warm, expressive storytelling"),
   ("Pranav","Male","English","Friendly support"),("Shlok","Male","English","Warm conversational"),("Poorvi","Female","Hinglish","Natural bilingual conversation"),
   ("Ambuja","Female","Hindi","Clear, composed assistant"),("Bhavna","Female","Hindi","Friendly support"),("Chitra","Female","Hindi","Mature, empathetic"),("Jwala","Female","Hindi","Friendly, everyday"),("Nalini","Female","Hindi","Friendly, playful"),
   ("Urmila","Female","Hindi","Refined, formal"),("Yashvi","Female","Hindi","Gentle, reassuring"),("Deepak","Male","Hindi","Clear, measured"),("Hemraj","Male","Hindi","Confident"),("Jalaj","Male","Hindi","Expressive storytelling"),
   ("Omkar","Male","Hindi","Energetic"),("Roopesh","Male","Hindi","Grounded, knowledgeable"),("Vikrant","Male","Hindi","Warm, conversational"),
   ("Asmita","Female","Tamil","Polished, smooth"),("Brinda","Female","Tamil","Steady professional"),("Noopur","Female","Tamil","Warm everyday"),("Trisha","Female","Tamil","Warm guidance"),("Vedika","Female","Tamil","Crisp, articulate"),
   ("Lavanya","Female","Telugu","Soft, empathetic"),("Lehara","Female","Telugu","Gentle"),("Suhana","Female","Telugu","Calm, soothing"),("Varuni","Female","Telugu","Clear, natural"),("Yukti","Female","Telugu","Warm, welcoming"),
   ("Kavin","Male","Kannada","Firm, articulate"),("Saanvi","Female","Kannada","Lively"),("Reshma","Female","Malayalam","Bright"),("Riyaan","Male","Malayalam","Easygoing"),
   ("Ishaan","Male","Marathi","Clear narration"),("Zahira","Female","Marathi","Energetic"),("Mehuli","Female","Punjabi","Expressive"),("Zayan","Male","Punjabi","Soft, caring"),
   ("Dhruva","Male","Bengali","Casual"),("Kirra","Female","Bengali","Soft-spoken"),("Falak","Female","Gujarati","Youthful, clear"),("Veera","Male","Gujarati","Friendly")]),
}
DEFAULT_VOICE = {"timbre-v3.0": "Shivani", "timbre-v2.5": "Kaveri"}
VOICES = [v["name"] for m in CATALOG.values() for v in m]      # every valid name (any model)
TTS_LANGS = {"auto","hi-IN","en-IN","ta-IN","te-IN","kn-IN","ml-IN","mr-IN","pa-IN","bn-IN","gu-IN","hi-en"}
GNANI_TTS_VOICE = env("GNANI_TTS_VOICE", "Shivani")
if GNANI_TTS_MODEL not in {"timbre-v2.5", "timbre-v3.0"}:
    GNANI_TTS_MODEL = "timbre-v3.0"
if GNANI_TTS_VOICE not in [v["name"] for v in CATALOG[GNANI_TTS_MODEL]]:
    GNANI_TTS_VOICE = DEFAULT_VOICE[GNANI_TTS_MODEL]
