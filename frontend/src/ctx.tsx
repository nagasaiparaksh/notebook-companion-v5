import { createContext, useCallback, useContext, useEffect, useState } from "react"; import { api } from "./api";
export type AI = { state: "checking" | "ok" | "down" | "unconfigured"; model?: string; error?: string };
type C = { status: any; ai: AI; recheckAi: () => void; languages: { code: string; name: string }[]; lang: string; setLang: (l: string) => void; voice: string; setVoice: (v: string) => void };
const Ctx = createContext<C>({} as C); export const useApp = () => useContext(Ctx);
export function Provider({ children }: any) {
  const [status, setStatus] = useState<any>(null), [languages, setLanguages] = useState<any[]>([]), [ai, setAi] = useState<AI>({ state: "checking" });
  const [lang, setLangS] = useState(localStorage.getItem("lang") || "en-IN"), [voice, setVoiceS] = useState(localStorage.getItem("voice") || "");
  const recheckAi = useCallback(() => { setAi({ state: "checking" }); api("/ai/check").then((r) => setAi(r.ok ? { state: "ok", model: r.model } : { state: r.setup ? "unconfigured" : "down", error: r.error })).catch((e) => setAi({ state: "down", error: e.message })); }, []);
  useEffect(() => { api("/status").then((s) => { setStatus(s); const saved = localStorage.getItem("voice") || ""; const selected = s.voices?.includes(saved) ? saved : (s.default_voice || "Shivani"); setVoiceS(selected); localStorage.setItem("voice", selected); }).catch((e) => setStatus({ offline: e.message })); api("/languages").then(setLanguages).catch(() => {}); recheckAi(); }, []);
  const setLang = (l: string) => { setLangS(l); localStorage.setItem("lang", l); }, setVoice = (v: string) => { setVoiceS(v); localStorage.setItem("voice", v); };
  return <Ctx.Provider value={{ status, ai, recheckAi, languages, lang, setLang, voice, setVoice }}>{children}</Ctx.Provider>;
}
export function LangSelect() { const { languages, lang, setLang } = useApp(); return <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">{languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>; }
/** Header lights: tells the truth about whether the AI model and the voice service actually answer. */
export function StatusPills() {
  const { status, ai, recheckAi } = useApp(); if (!status) return null;
  const aiTxt = ai.state === "ok" ? `AI ready${ai.model ? " · " + ai.model : ""}` : ai.state === "checking" ? "Checking AI…" : ai.state === "unconfigured" ? "AI not set up" : "AI not responding";
  return <div className="pills"><button className={"pill " + (ai.state === "ok" ? "ok" : ai.state === "checking" ? "wait" : "bad")} onClick={recheckAi} title={ai.error || "Click to re-check"}><i />{aiTxt}</button>
    <span className={"pill " + (status.gnani ? "ok" : "bad")} title={status.gnani ? "Gnani voice key found" : "GNANI_API_KEY is missing in backend/.env"}><i />{status.gnani ? "Voice ready" : "Voice not set up"}</span></div>;
}
export function SetupBanner() {
  const { status, ai, recheckAi } = useApp(); if (!status) return null;
  if (status.offline) return <div className="banner">{status.offline}</div>;
  if (ai.state === "down" || ai.state === "unconfigured") return <div className="banner" role="alert"><b>The AI isn't answering.</b> {ai.error} <button className="btn sm mint" onClick={recheckAi}>Check again</button></div>;
  return !status.gnani ? <div className="banner">Voice isn't set up yet: add <b>GNANI_API_KEY</b> to <b>backend/.env</b> and restart Flask.</div> : null;
}
