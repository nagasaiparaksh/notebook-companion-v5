import { useEffect, useMemo, useState } from "react"; import { useNavigate } from "react-router-dom"; import { api } from "../api";
const COL = ["#D9D2FF", "#C9F2DD", "#FFD0C2", "#FFF3A3", "#BFD4FF", "#FFE0C7"];
export default function Garden() {
  const nav = useNavigate(); const [g, setG] = useState<any>(null), [err, setErr] = useState(""), [pos, setPos] = useState<Record<string, [number, number]>>({});
  useEffect(() => { api("/graph").then(setG).catch((e) => setErr(e.message)); }, []);
  const cats = useMemo(() => [...new Set((g?.nodes || []).map((n: any) => n.category).filter(Boolean))] as string[], [g]);
  useEffect(() => {
    if (!g) return; const N = g.nodes, P: Record<string, number[]> = {}; N.forEach((n: any, i: number) => { const a = (i / N.length) * 6.28; P[n.id] = [450 + Math.cos(a) * 250, 300 + Math.sin(a) * 200, 0, 0]; });
    for (let it = 0; it < 300; it++) {
      for (const a of N) for (const b of N) if (a.id < b.id) { const dx = P[a.id][0] - P[b.id][0], dy = P[a.id][1] - P[b.id][1], d = Math.hypot(dx, dy) || 1, f = 9000 / (d * d); P[a.id][2] += dx / d * f; P[a.id][3] += dy / d * f; P[b.id][2] -= dx / d * f; P[b.id][3] -= dy / d * f; }
      for (const e of g.edges) { const A = P[e.from], B = P[e.to]; if (!A || !B) continue; const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, f = (d - 130) * 0.02; A[2] += dx / d * f; A[3] += dy / d * f; B[2] -= dx / d * f; B[3] -= dy / d * f; }
      for (const n of N) { const p = P[n.id]; p[2] += (450 - p[0]) * 0.004; p[3] += (300 - p[1]) * 0.004; p[0] = Math.min(860, Math.max(40, p[0] + p[2] * 0.6)); p[1] = Math.min(570, Math.max(30, p[1] + p[3] * 0.6)); p[2] *= 0.5; p[3] *= 0.5; }
    }
    setPos(Object.fromEntries(N.map((n: any) => [n.id, [P[n.id][0], P[n.id][1]]])));
  }, [g]);
  const wob = (x: number, y: number, r: number, s: number) => { let d = ""; for (let i = 0; i <= 20; i++) { const a = (i / 20) * 6.283, k = r + Math.sin(a * 3 + s) * 2.5; d += (i ? "L" : "M") + (x + Math.cos(a) * k * 1.25).toFixed(1) + " " + (y + Math.sin(a) * k).toFixed(1); } return d + "Z"; };
  if (err) return <div className="err">{err}</div>; if (!g) return <p className="muted">Planting…</p>;
  return <div><h1>Knowledge garden</h1><p className="muted">Notes share tags (dotted) or similar ideas (solid). Click a note to open it. {cats.map((c, i) => <span key={c} className="chip" style={{ background: COL[i % 6] }}>{c}</span>)}</p>
    {!g.nodes.length ? <p>No notes to grow yet.</p> : <svg viewBox="0 0 900 600" style={{ width: "100%", border: "2px solid #2B2B2B", borderRadius: "6px 14px 6px 14px", background: "rgba(255,255,255,.5)" }}>
      {g.edges.map((e: any, i: number) => pos[e.from] && pos[e.to] && <line key={i} x1={pos[e.from][0]} y1={pos[e.from][1]} x2={pos[e.to][0]} y2={pos[e.to][1]} stroke={e.kind === "related" ? "#3B5BDB" : "#999"} strokeWidth={e.kind === "related" ? 2.5 : 1.5} strokeDasharray={e.kind === "tag" ? "3 5" : ""} />)}
      {g.nodes.map((n: any, i: number) => pos[n.id] && <g key={n.id} style={{ cursor: n.type === "note" ? "pointer" : "default" }} onClick={() => n.type === "note" && nav("/notes?open=" + n.note_id)}>
        <path d={wob(pos[n.id][0], pos[n.id][1], n.type === "note" ? 30 : 14, i)} fill={n.type === "note" ? COL[Math.max(0, cats.indexOf(n.category)) % 6] : "#fff"} stroke="#2B2B2B" strokeWidth="2.2" />
        <text x={pos[n.id][0]} y={pos[n.id][1] + (n.type === "note" ? 50 : 30)} textAnchor="middle" fontSize={n.type === "note" ? 16 : 13} fill="#2B2B2B" style={{ fontFamily: "'Patrick Hand',cursive" }}>{n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label}</text></g>)}
    </svg>}</div>;
}
