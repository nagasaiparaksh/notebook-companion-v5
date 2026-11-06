import { createContext, useContext, useEffect, useState } from "react"; import { api } from "./api";
/** Accounts: each person logs in with a username and password and sees only their own notebooks. */
export type User = { id: number; username: string };
const UserCtx = createContext<{ user: User; logout: () => void } | null>(null);
export const useUser = () => useContext(UserCtx);
/** Back to the home page and a clean slate, so nothing of the previous account stays in memory. */
const freshStart = () => { history.replaceState(null, "", location.pathname + location.search + "#/"); location.reload(); };

/** Log in / create an account. As a page before anyone is signed in, or as a box over the app when the login has run out
 *  (unsaved work stays on screen and is saved once the same person logs in again). */
function LoginForm({ again, onDone }: { again?: User; onDone: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login"), [name, setName] = useState(again?.username || ""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), signup = mode === "register";
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (signup && pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    try { const r = await api("/auth/" + mode, { json: { username: name.trim(), password: pw } }); onDone(r.user); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  }
  const field = { width: "100%", fontSize: 18 } as const;
  return <form className="modal login" onSubmit={go} aria-label={signup ? "Create an account" : "Log in"}>
    <h2 style={{ marginTop: 0 }}>{signup ? "Create your account" : again ? "Please log in again" : "Log in"}</h2>
    <p className="muted" style={{ marginTop: 0 }}>{signup ? "Pick a username and a password. Your notebooks are private to your account." : again ? "Your login ran out. Your work on screen is kept." : "Welcome back to your notebooks."}</p>
    <label className="col" style={{ gap: 2 }}>Username
      <input autoFocus={!again} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} style={field} /></label>
    <label className="col" style={{ gap: 2, marginTop: 8 }}>Password
      <input type="password" autoFocus={!!again} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} style={field} /></label>
    {signup && <label className="col" style={{ gap: 2, marginTop: 8 }}>Password again
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" style={field} /></label>}
    {signup && <div className="muted" style={{ fontSize: 16, marginTop: 4 }}>3–32 letters, numbers, dots, dashes or underscores; password at least 6 characters.</div>}
    {err && <div className="err" role="alert">{err}</div>}
    <div className="row" style={{ marginTop: 12 }}>
      <button className="btn blue" disabled={busy || !name.trim() || !pw || (signup && !pw2)}>{busy ? (signup ? "Creating…" : "Checking…") : signup ? "Create account" : "Log in"}</button>
      <span className="grow" />
      {!again && <button type="button" className="btn sm ghost" onClick={() => { setMode(signup ? "login" : "register"); setErr(""); setPw(""); setPw2(""); }}>
        {signup ? "I already have an account" : "New here? Create an account"}</button>}
      {again && <button type="button" className="btn sm ghost" onClick={() => void api("/auth/logout", { method: "POST" }).finally(freshStart)}>Use another account</button>}
    </div>
  </form>;
}

/** Shows the login page (under `header`) until someone is signed in, then the app (`children`, which has its own header). */
export function Account({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined), [expired, setExpired] = useState(false), [err, setErr] = useState("");
  const check = () => api("/auth/me").then((r) => { setErr(""); setUser(r.user); }).catch((e) => setErr(e.message));
  useEffect(() => { void check(); }, []);
  useEffect(() => { const h = () => setUser((u) => { if (u) setExpired(true); return u; }); window.addEventListener("nc-login-needed", h); return () => window.removeEventListener("nc-login-needed", h); }, []);
  const logout = () => void api("/auth/logout", { method: "POST" }).catch(() => {}).finally(freshStart);
  if (user === undefined) return <>{header}{err && <div className="banner">{err}</div>}</>;
  if (user === null) return <>{header}<main className="login-page"><LoginForm onDone={(u) => { history.replaceState(null, "", location.pathname + location.search + "#/"); setUser(u); }} /></main></>;
  return <UserCtx.Provider value={{ user, logout }}>{children}
    {expired && <div className="modal-back"><LoginForm again={user} onDone={(u) => (u.id === user.id ? setExpired(false) : freshStart())} /></div>}
  </UserCtx.Provider>;
}

/** Header: who is signed in, and Log out. */
export function AccountChip() {
  const ctx = useUser(); if (!ctx) return null;
  return <span className="acct"><span className="pill" title="Signed in">👤 {ctx.user.username}</span><button className="btn sm ghost" onClick={ctx.logout}>Log out</button></span>;
}
