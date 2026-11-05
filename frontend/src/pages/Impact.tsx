import { useEffect, useState } from "react"; import { useNavigate } from "react-router-dom"; import { api } from "../api";

/** What the app has actually done for the people using it: real numbers from this installation, plus their own words. */
export default function Impact() {
  const nav = useNavigate(); const [s, setS] = useState<any>(null), [err, setErr] = useState(""), [rating, setRating] = useState(0), [text, setText] = useState(""), [name, setName] = useState(""), [sent, setSent] = useState(false);
  const load = () => api("/stats/impact").then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function send() { try { await api("/stats/feedback", { json: { rating: rating || null, text, name } }); setSent(true); setText(""); setRating(0); load(); } catch (e: any) { setErr(e.message); } }
  const Stat = ({ n, label, sub }: { n: any; label: string; sub?: string }) => <div className="stat"><b>{n ?? "–"}</b><span>{label}</span>{sub && <small className="muted">{sub}</small>}</div>;
  const gain = s && s.accuracy_tests ? s.terms_with - s.terms_without : 0;
  return <main className="home impact">
    <div className="row"><button className="btn sm ghost" onClick={() => nav("/")}>← Notebooks</button><h1 className="grow" style={{ margin: 0 }}>📈 Impact</h1><button className="btn sm ghost" onClick={load}>Refresh</button></div>
    <p className="muted">Real numbers from this app's own use{s?.since ? `, since ${new Date(s.since * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}. Nothing here is sent anywhere.</p>
    {err && <div className="err" onClick={() => setErr("")}>{err}</div>}
    {!s ? <p className="muted">Loading…</p> : <>
      <h2>Listening (Gnani Prisma v3)</h2>
      <div className="stats">
        <Stat n={s.speech_minutes} label="minutes of speech transcribed" sub={`${s.speech_words.toLocaleString()} words`} />
        <Stat n={s.live_minutes} label="minutes of live lecture captions" />
        <Stat n={`${s.with_context_share}%`} label="transcribed with course terms" sub="syllabus-aware recognition" />
        <Stat n={s.recordings} label="recorded lectures uploaded" sub="speaker-labelled by Gnani Batch" />
      </div>
      {Object.keys(s.languages).length > 0 && <div className="lang-bars">{Object.entries(s.languages).map(([k, v]: any) => <div key={k} className="row"><span style={{ width: 90 }}>{k}</span><i style={{ width: `${Math.max(4, (100 * v) / Math.max(...(Object.values(s.languages) as number[])))}%` }} /><small className="muted">{v} min</small></div>)}</div>}
      <h2>Accuracy</h2>
      <div className="stats">
        <Stat n={s.accuracy_tests} label="with/without tests run" />
        <Stat n={s.accuracy_tests ? `${s.terms_with} vs ${s.terms_without}` : "–"} label="course terms heard correctly" sub="with course terms vs without" />
        <Stat n={s.accuracy_tests ? (gain >= 0 ? `+${gain}` : gain) : "–"} label="terms gained by syllabus-awareness" />
      </div>
      <h2>Studying</h2>
      <div className="stats">
        <Stat n={s.notebooks} label="notebooks" sub={`${s.words_in_notes.toLocaleString()} words of notes`} />
        <Stat n={s.lectures} label="lectures turned into notes" />
        <Stat n={s.study_sets} label="quizzes, flashcards and gap checks" />
        <Stat n={s.coverage_avg != null ? `${s.coverage_avg}%` : "–"} label="average syllabus coverage" sub={`${s.coverage_checks} checks`} />
        <Stat n={s.translations} label="explanations heard in an Indian language" />
        <Stat n={s.active_days} label="days used" />
      </div>
      <h2>What people say</h2>
      <div className="feedback-form">
        <div className="row">{[1, 2, 3, 4, 5].map((r) => <button key={r} className={"btn sm " + (r <= rating ? "mint" : "ghost")} onClick={() => setRating(r)} aria-label={`${r} star${r === 1 ? "" : "s"}`}>★</button>)}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name / class (optional)" aria-label="Your name" /></div>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="How did it help in your class? What should be better?" aria-label="Feedback" />
        <button className="btn sm blue" disabled={!text.trim() && !rating} onClick={() => void send()}>Send feedback</button>{sent && <span className="muted"> Thanks!</span>}
      </div>
      {s.feedback.length ? <div className="quotes">{s.feedback.map((f: any, i: number) => <blockquote key={i}>{f.rating ? <span className="stars">{"★".repeat(f.rating)}</span> : null} {f.text}{f.name ? <cite> · {f.name}</cite> : null}</blockquote>)}</div> : <p className="muted">No feedback yet. Ask classmates to try it for a lecture and leave a line here.</p>}
    </>}
  </main>;
}
