import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react"; import { api } from "./api";
import { Provider, SetupBanner, StatusPills } from "./ctx"; import { Account, AccountChip } from "./auth";
import Home from "./pages/Home"; import Notebook from "./pages/Notebook"; import Impact from "./pages/Impact";
import Capture from "./pages/Capture"; import Companion from "./pages/Companion"; import DiagramStudio from "./diagram/Studio"; import Garden from "./pages/Garden";
/** Old links (/notes?open=12, /notes?new=1) keep working. */
function LegacyNotes() { const [sp] = useSearchParams(); const o = sp.get("open"); return <Navigate to={o ? `/n/${o}` : "/"} replace />; }
/** Shown when the server requires an access code (APP_ACCESS_CODE): the code is checked by the server and remembered in a cookie. */
function AccessGate() {
  const [need, setNeed] = useState(false), [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const h = () => setNeed(true); window.addEventListener("nc-access-needed", h); return () => window.removeEventListener("nc-access-needed", h); }, []);
  if (!need) return null;
  async function go(e: React.FormEvent) { e.preventDefault(); setBusy(true); setErr(""); try { await api("/access", { json: { code } }); location.reload(); } catch (x: any) { setErr(x.message); setBusy(false); } }
  return <div className="modal-back"><form className="modal" style={{ maxWidth: 420 }} onSubmit={go} aria-label="Access code">
    <h2 style={{ marginTop: 0 }}>✎ my notebook</h2><p className="muted">This notebook is private. Enter the access code you were given.</p>
    <input type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} aria-label="Access code" style={{ width: "100%", fontSize: 18, boxSizing: "border-box" }} />
    {err && <div className="err">{err}</div>}<div className="row" style={{ marginTop: 10 }}><button className="btn blue" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Open"}</button></div>
  </form></div>;
}
export default function App() {
  const onNotebook = useLocation().pathname.startsWith("/n/");
  return <div className={"app" + (onNotebook ? " is-notebook" : "")}><AccessGate />
    <Account header={<header className="top"><Link className="logo" to="/">✎ my notebook</Link></header>}><Provider>
    <header className="top"><Link className="logo" to="/">✎ my notebook</Link><StatusPills /><AccountChip /></header>
    <SetupBanner />
    <Routes><Route path="/" element={<Home />} /><Route path="/n/:id" element={<Notebook />} /><Route path="/notes" element={<LegacyNotes />} />
      <Route path="/capture" element={<Capture />} /><Route path="/companion" element={<Companion />} /><Route path="/diagrams" element={<DiagramStudio />} /><Route path="/garden" element={<Garden />} /><Route path="/impact" element={<Impact />} /></Routes>
  </Provider></Account></div>;
}
