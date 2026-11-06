"""LLM client (OpenAI-compatible, tuned for Gemini).

Why this was rewritten: Google retired gemini-2.5-flash / gemini-2.5-flash-lite (calls return 404 "no longer available").
The old client treated that as a hard failure, so every AI feature died. Now:
  * every request walks a list of candidate models (last-known-good, configured, fallback);
  * if they all report "model gone", the provider's model list is queried and the newest Flash models are probed;
  * the model that works is remembered for the process lifetime;
  * the real provider error is kept (status() / check()) so the UI can show it instead of failing silently.
"""
import json, re, time, requests
import config

class NotConfigured(Exception): pass

_session = requests.Session()
RETRY = (429, 500, 502, 503, 504)
_state = {"working": None, "last_error": "", "discovered": [], "discovered_at": 0.0}

def _check():
    if not (config.LLM_BASE_URL and config.LLM_API_KEY and config.LLM_MODEL):
        raise NotConfigured("LLM not configured. Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in backend/.env.")

# A second, independent provider (e.g. Groq or Cerebras: free, fast, OpenAI-compatible). When the main one is rate-limited (429),
# down (5xx) or too slow, the same request is retried there at once, so one provider's quota never stops the app.
BACKUP = "backup:"
def _backup_models(): return [BACKUP + m.strip() for m in (config.LLM2_MODEL or "").split(",") if m.strip()] if (config.LLM2_BASE_URL and config.LLM2_API_KEY) else []
def _headers(model=""): return {"Authorization": f"Bearer {config.LLM2_API_KEY if model.startswith(BACKUP) else config.LLM_API_KEY}"}
def _url(model=""): return (config.LLM2_BASE_URL if model.startswith(BACKUP) else config.LLM_BASE_URL).rstrip("/") + "/chat/completions"

def _configured():
    out = []
    for m in (_state["working"], config.LLM_MODEL, config.LLM_FALLBACK_MODEL):
        if m and m not in out: out.append(m)
    # the backup provider comes straight after the main model: trying four more Gemini models that share the same quota is pointless
    bk = [m for m in _backup_models() if m not in out]
    return out[:2] + bk + out[2:] if bk else out

def _ver(model):
    m = re.match(r"gemini-(\d+)(?:\.(\d+))?", model)
    return (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)

def _discover(exclude):
    """Ask the provider which models exist and return the best Flash candidates (newest first)."""
    if time.time() - _state["discovered_at"] > 600 or not _state["discovered"]:
        try:
            r = _session.get(config.LLM_BASE_URL.rstrip("/") + "/models", headers=_headers(), timeout=(6, 8))
            ids = [str(x.get("id", "")).replace("models/", "") for x in (r.json().get("data") or [])] if r.status_code == 200 else []
        except Exception: ids = []
        bad = ("image", "tts", "live", "audio", "embedding", "thinking", "exp", "vision", "robotics", "computer", "native", "customtools", "gemma", "learnlm")
        ids = [i for i in ids if i.startswith("gemini-") and "flash" in i and not any(b in i for b in bad)]
        ids.sort(key=lambda i: (_ver(i), "lite" not in i, "preview" not in i), reverse=True)
        _state["discovered"], _state["discovered_at"] = ids, time.time()
    return [m for m in _state["discovered"] if m not in exclude][:4]

def _thinks(model): return any(k in model.lower() for k in ("gpt-oss", "qwen3", "-r1", "deepseek-reason", "o1", "o3", "o4"))
def _reasoning(model):
    """Only send reasoning_effort when a real level is configured. Measured: forcing "minimal" on Gemini 3 Flash made a short
    classification take ~14 s; leaving the parameter out answered in ~1 s. So "none" (the default) means: don't send it."""
    if "gpt-oss" in model: return "low"            # measured on Groq: 1-2.6 s per request in low effort, valid JSON
    eff = (config.LLM_REASONING_EFFORT or "").strip().lower()
    if eff in ("", "none", "off") or "gemini" not in model: return None
    if _ver(model)[0] == 2 and "pro" in model: return None
    return eff

def _body(model, messages, temperature, json_mode, max_tokens, stream, reasoning=True):
    b = {"model": model[len(BACKUP):] if model.startswith(BACKUP) else model, "messages": messages, "temperature": temperature}
    if json_mode: b["response_format"] = {"type": "json_object"}
    # reasoning models (GPT-OSS, Qwen3, DeepSeek-R1) spend part of max_tokens on hidden thinking: with a small limit the
    # visible answer comes back EMPTY (measured: max_tokens=16 -> 14 thinking tokens, no answer). Give them room on top.
    if max_tokens: b["max_tokens"] = max_tokens + 1024 if _thinks(model) else max_tokens
    if stream: b["stream"] = True
    eff = _reasoning(model) if reasoning else None
    if eff: b["reasoning_effort"] = eff
    return b

def _post(model, messages, temperature, json_mode, max_tokens, stream, timeout):
    """One request; if the provider rejects an optional parameter, retry once without it."""
    reasoning, jm = True, json_mode
    for _ in range(2):
        r = _session.post(_url(model), json=_body(model, messages, temperature, jm, max_tokens, stream, reasoning), headers=_headers(model), timeout=timeout, stream=stream)
        if r.status_code != 400: return r
        t = r.text.lower(); changed = False
        if reasoning and ("reasoning" in t or "thinking" in t): reasoning, changed = False, True
        if jm and ("response_format" in t or "json" in t): jm, changed = False, True
        if not changed: return r
    return r

def _discover_backup(exclude):
    """The backup provider retires models too (Groq dropped llama-3.3-70b-versatile): ask it what it offers now."""
    if _state.get("bk_at", 0) > time.time() - 600 and _state.get("bk"): ids = _state["bk"]
    else:
        try:
            r = _session.get(config.LLM2_BASE_URL.rstrip("/") + "/models", headers=_headers(BACKUP), timeout=(6, 8))
            ids = [str(m.get("id")) for m in (r.json().get("data") or []) if m.get("active", True)] if r.status_code == 200 else []
        except Exception: ids = []
        bad = ("guard", "whisper", "orpheus", "tts", "allam", "embed", "safeguard", "vision", "audio")
        ids = [i for i in ids if not any(b in i.lower() for b in bad)]
        pref = ("gpt-oss-120b", "qwen", "llama-4", "llama-3.3", "kimi", "deepseek", "gpt-oss-20b", "llama")
        ids.sort(key=lambda i: next((k for k, p in enumerate(pref) if p in i.lower()), len(pref)))
        _state["bk"], _state["bk_at"] = ids, time.time()
    return [BACKUP + i for i in ids if BACKUP + i not in exclude][:3]

def _gone(r):
    t = r.text.lower()
    return r.status_code == 404 or (r.status_code == 400 and "model" in t and any(k in t for k in ("not found", "no longer available", "not supported", "does not exist", "invalid model")))

def _open(messages, temperature, json_mode, max_tokens, stream, timeout):
    """Returns (response, model) for the first candidate that answers 200. Raises RuntimeError with the real reason otherwise."""
    _check(); errors, tried, queue, discovered = [], [], _configured(), False
    # one time budget for the whole request: trying the next model must not stack another full timeout on top
    # (a 12 s classification once took 31 s that way while the provider was slow)
    start, budget = time.time(), (timeout[1] if isinstance(timeout, tuple) else timeout) * 1.25
    while queue:
        model = queue.pop(0)
        if model in tried: continue
        if tried and time.time() - start > budget: errors.append("gave up: the AI is answering too slowly right now"); break
        tried.append(model)
        for attempt in range(2):
            try: r = _post(model, messages, temperature, json_mode, max_tokens, stream, timeout)
            except (requests.Timeout, requests.ConnectionError): errors.append(f"{model}: timed out or unreachable"); break
            if r.status_code == 200: _state["working"], _state["last_error"], _state["ok_at"], _state["bk_tried"] = model, "", time.time(), False; return r, model
            snippet = re.sub(r"\s+", " ", r.text)[:220]
            if r.status_code in (401, 403):
                if model.startswith(BACKUP) or _backup_models():                 # a bad key on one provider must not hide the other one
                    errors.append(f"{model}: key rejected ({r.status_code})"); break
                msg = f"The AI provider rejected the API key or this request ({r.status_code}): {snippet}"; _state["last_error"] = msg; raise RuntimeError(msg)
            if r.status_code == 429 and attempt == 0 and time.time() - start < budget * 0.6: time.sleep(1.2); continue
            if _gone(r):
                errors.append(f"{model}: no longer available (404)")
                if _state["working"] == model: _state["working"] = None
                if model.startswith(BACKUP) and not _state.get("bk_tried"):          # a retired backup model: use what the provider offers today
                    _state["bk_tried"] = True; queue[0:0] = _discover_backup(tried)
            elif r.status_code in RETRY: errors.append(f"{model}: {r.status_code}")
            else: errors.append(f"{model}: HTTP {r.status_code} {snippet}")
            break
        if not queue and not discovered and time.time() - start < budget * 0.5:   # every configured model failed: look for what the provider offers today
            discovered = True; queue.extend(_discover(tried))
    msg = "The AI provider could not answer. " + "; ".join(errors[:5]) + (". Set LLM_MODEL in backend/.env to a model your key can use." if any("no longer" in e for e in errors) else "")
    _state["last_error"] = msg; raise RuntimeError(msg)

def chat(messages, json_mode=False, temperature=0.4, max_tokens=None, timeout=(6, 60)):
    mt = max_tokens
    for _ in range(2):   # a 200 with empty text is retried once (with more room if it was cut off)
        r, model = _open(messages, temperature, json_mode, mt, False, timeout)
        try: ch = r.json()["choices"][0]; text = ch["message"].get("content"); cut = ch.get("finish_reason") == "length"
        except Exception: text, cut = None, False
        if text and text.strip(): return text
        if cut and mt: mt = mt * 3; continue                                     # ran out of room while thinking: same model, more room
        _state["working"] = None; _state["last_error"] = f"{model} returned an empty reply"
    raise RuntimeError(f"The AI returned an empty reply ({_state['last_error']}). Please try again.")

def stream_chat(messages, temperature=0.4, max_tokens=None):
    r, model = _open(messages, temperature, False, max_tokens, True, (6, 60)); got = False
    r.encoding = "utf-8"   # Groq's stream says only "text/event-stream": requests would decode it as Latin-1 and garble Telugu, Hindi, "–" …
    try:
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"): continue
            data = line[5:].strip()
            if data == "[DONE]": break
            try: delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
            except Exception: continue
            if delta: got = True; yield delta
    except (requests.Timeout, requests.ConnectionError):
        if not got: raise RuntimeError(f"{model} stopped responding. Please try again.")
        return
    if not got: raise RuntimeError(f"{model} returned an empty reply. Please try again.")

def chat_json(messages, max_tokens=4096, timeout=(6, 60)):
    txt = chat(messages, json_mode=True, temperature=0.2, max_tokens=max_tokens, timeout=timeout)
    txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.M).strip()
    m = re.search(r"\{.*\}", txt, re.S)
    if not m: raise RuntimeError("LLM did not return JSON.")
    try: return json.loads(m.group(0))
    except json.JSONDecodeError as e: raise RuntimeError(f"LLM returned invalid JSON: {e}")

def embed_remote(texts):
    r = _session.post(config.EMBED_BASE_URL.rstrip("/") + "/embeddings", timeout=(6, 30),
                      json={"model": config.EMBED_MODEL, "input": texts},
                      headers={"Authorization": f"Bearer {config.EMBED_API_KEY}"})
    if r.status_code != 200: raise RuntimeError(f"Embedding error {r.status_code}: {r.text[:300]}")
    return [d["embedding"] for d in r.json()["data"]]

def check():
    """Real end-to-end probe used by the header status light."""
    try: _check()
    except NotConfigured as e: return {"ok": False, "error": str(e), "setup": True}
    # every page load used to spend a real AI call here (up to 20 s, and it ate into the rate limit, slowing everything else):
    # reuse any successful call or probe from the last 10 minutes
    if time.time() - _state.get("ok_at", 0) < 600: return {"ok": True, "model": _state["working"]}
    c = _state.get("check")
    if c and time.time() - c[0] < 120: return c[1]
    try:
        chat([{"role": "user", "content": "Reply with the single word OK."}], max_tokens=64, timeout=(6, 15))
        res = {"ok": True, "model": _state["working"]}
    except Exception as e: res = {"ok": False, "error": str(e)}
    _state["check"] = (time.time(), res); return res

def status():
    return {"llm": bool(config.LLM_BASE_URL and config.LLM_API_KEY and config.LLM_MODEL), "llm_model": (_state["working"] or config.LLM_MODEL).replace(BACKUP, "backup · "), "llm_error": _state["last_error"],
            "llm_backup": ", ".join(m[len(BACKUP):] for m in _backup_models()) or None,
            "embeddings": "remote" if (config.EMBED_BASE_URL and config.EMBED_MODEL) else "local-tfidf",
            "gnani": bool(config.GNANI_API_KEY)}
