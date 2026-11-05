import { useEffect, useRef, useState } from "react"; import { useNavigate } from "react-router-dom"; import { api } from "../api"; import { useApp } from "../ctx";
const COVERS = ["#FFE45C", "#C9F2DD", "#FFD0C2", "#D9D2FF", "#BFD4FF", "#FFD9C0"];
const ago = (t: number) => { const s = Math.max(1, Math.round(Date.now() / 1000 - t)); if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
const tourDone = () => { try { return localStorage.getItem("tourDone") === "1"; } catch { return false; } };
type Backup = { dir: string; count: number; last: number | null; keep: number; every_hours: number; cloud: boolean };

export default function Home() {
  const nav = useNavigate(); const { lang } = useApp(); const [notes, setNotes] = useState<any[] | null>(null), [err, setErr] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const [showTour, setShowTour] = useState(!tourDone()), [bk, setBk] = useState<Backup | null>(null);
  const pickDoc = useRef<HTMLInputElement>(null), pickBackup = useRef<HTMLInputElement>(null);
  const load = () => api("/notes").then(setNotes).catch((e) => { setErr(e.message); setNotes([]); });
  const loadBk = () => api("/backup/status").then(setBk).catch(() => {});
  useEffect(() => { load(); loadBk(); }, []);
  async function create() { setBusy("new"); setErr(""); try { const n = await api("/notes", { json: { title: "Untitled notebook", language: lang } }); nav(`/n/${n.id}?new=1`); } catch (e: any) { setErr(e.message); setBusy(""); } }
  async function startTour() { setBusy("tour"); setErr(""); try { const n = await api("/notes", { json: { title: "Welcome: try me", language: lang } }); nav(`/n/${n.id}?tour=1`); } catch (e: any) { setErr(e.message); setBusy(""); } }
  const hideTour = () => { setShowTour(false); try { localStorage.setItem("tourDone", "1"); } catch {} };
  async function importDoc(f: File) {
    setBusy("doc"); setErr(""); setMsg("");
    try {
      const fd = new FormData(); fd.append("file", f); const r = await api("/import/document", { method: "POST", body: fd });
      const n = await api("/notes", { json: { title: r.title || "Imported document", language: lang, sheets: r.sheets.map((html: string) => ({ html, objects: [] })) } });
      if (r.problems?.length) alert(r.problems.join("\n")); nav(`/n/${n.id}`);
    } catch (e: any) { setErr(e.message); setBusy(""); }
  }
  async function restore(f: File) {
    setBusy("restore"); setErr(""); setMsg("");
    try { const fd = new FormData(); fd.append("file", f); const r = await api("/backup/import", { method: "POST", body: fd }); setMsg(`Restored ${r.added} notebook${r.added === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} you already had were skipped)` : ""}.`); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(""); }
  }
  async function backupNow() { setBusy("bk"); try { setBk(await api("/backup/now", { method: "POST" })); setMsg("Backup saved."); } catch (e: any) { setErr(e.message); } finally { setBusy(""); } }
  async function pin(n: any) { await api("/notes/" + n.id, { method: "PUT", json: { pinned: n.pinned ? 0 : 1 } }).catch((e) => setErr(e.message)); load(); }
  async function del(n: any) { if (!confirm(`Delete “${n.title}” for good?`)) return; await api("/notes/" + n.id, { method: "DELETE" }).catch((e) => setErr(e.message)); load(); }
  const list = notes || [], pinned = list.filter((n) => n.pinned), recent = list.filter((n) => !n.pinned).sort((a, b) => b.updated - a.updated);
  const Card = ({ n }: any) => <article className="cover" style={{ "--cover": COVERS[n.id % COVERS.length] } as any}>
    <button className="cover-open" onClick={() => nav(`/n/${n.id}`)}><span className="spine" aria-hidden />
      <span className="cover-body"><b className="cover-title">{n.title || "Untitled notebook"}</b><span className="cover-snip">{n.snippet || "Empty so far"}</span><span className="cover-meta">{n.sheet_count} {n.sheet_count === 1 ? "sheet" : "sheets"} · {ago(n.updated)}</span></span></button>
    <span className="cover-tools"><button onClick={() => pin(n)} aria-label={n.pinned ? "Unpin " + n.title : "Pin " + n.title} title={n.pinned ? "Unpin" : "Pin"}>{n.pinned ? "★" : "☆"}</button><button onClick={() => del(n)} aria-label={"Delete " + n.title} title="Delete">✕</button></span></article>;
  return <main className="home">
    {showTour && <div className="tour-banner" role="region" aria-label="Get started">
      <div className="grow"><b>✨ New here? Take the 1-minute guided notebook.</b><div className="muted">Talk, and watch your notes write themselves, turn into diagrams, read themselves out and quiz you. No setup.</div></div>
      <button className="btn blue" onClick={() => void startTour()} disabled={!!busy}>{busy === "tour" ? "Opening…" : "Start the tour"}</button>
      <button className="btn sm ghost" onClick={hideTour} aria-label="Hide this">✕</button></div>}
    <button className="new-nb" onClick={create} disabled={!!busy}><span className="plus" aria-hidden>+</span><span>{busy === "new" ? "Creating…" : "Create new notebook"}</span></button>
    <div className="home-tools">
      <button className="btn sm ghost" onClick={() => pickDoc.current?.click()} disabled={!!busy}>{busy === "doc" ? "Importing…" : "📝 Open a Word document as a notebook"}</button>
      {!showTour && <button className="btn sm ghost" onClick={() => void startTour()} disabled={!!busy}>✨ Guided tour</button>}
      <button className="btn sm ghost" onClick={() => nav("/impact")} title="Real usage numbers and feedback">📈 Impact</button>
    </div>
    <input ref={pickDoc} type="file" accept=".docx,.md,.markdown,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importDoc(f); }} />
    {err && <div className="err" onClick={() => setErr("")}>{err}</div>}{msg && <div className="caption ok" onClick={() => setMsg("")}>{msg}</div>}
    <section aria-labelledby="h-pinned"><h2 id="h-pinned">Pinned</h2>{pinned.length ? <div className="covers">{pinned.map((n) => <Card key={n.id} n={n} />)}</div> : <p className="muted">Star a notebook to keep it here.</p>}</section>
    <section aria-labelledby="h-recent"><h2 id="h-recent">Recently edited</h2>{notes === null ? <p className="muted">Loading…</p> : recent.length ? <div className="covers">{recent.map((n) => <Card key={n.id} n={n} />)}</div> : <p className="muted">{pinned.length ? "Nothing else yet." : "No notebooks yet. Create your first one above, or take the guided tour."}</p>}</section>
    <section className="backup-box" aria-labelledby="h-backup"><h2 id="h-backup">Backups</h2>
      <p className="muted" style={{ margin: "0 0 6px" }}>{bk ? <>Automatic backup of every notebook {bk.last ? <>· last copy <b>{ago(bk.last)}</b></> : "· none yet"} · newest {bk.keep} kept, every {bk.every_hours} h, in <code title={bk.dir}>{bk.dir}</code>.{bk.cloud ? " That folder syncs to the cloud." : <> To sync them to the cloud, set <code>BACKUP_DIR</code> in backend/.env to a OneDrive or Google Drive folder.</>}</> : "Backups are made automatically."}</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <a className="btn sm mint" href="/api/backup/export" download>⬇ Download all notebooks (backup file)</a>
        <button className="btn sm ghost" onClick={() => pickBackup.current?.click()} disabled={!!busy}>{busy === "restore" ? "Restoring…" : "⤴ Restore from a backup file"}</button>
        <button className="btn sm ghost" onClick={() => void backupNow()} disabled={!!busy}>{busy === "bk" ? "Saving…" : "Back up now"}</button>
      </div>
      <input ref={pickBackup} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void restore(f); }} />
    </section>
  </main>;
}
