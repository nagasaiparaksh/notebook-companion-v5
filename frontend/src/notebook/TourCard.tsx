import { useState } from "react";

export type TourStep = { title: string; text: string; say?: string; actions?: [string, () => void][] };
type P = { steps: TourStep[]; busy: boolean; onTry: (say: string) => void; onEnd: (finished: boolean) => void };

/** The guided first notebook: one short step at a time; "Try it" runs the real command, so it works with or without a microphone. */
export default function TourCard({ steps, busy, onTry, onEnd }: P) {
  const [i, setI] = useState(0), [tried, setTried] = useState<Set<number>>(new Set()), s = steps[i], last = i === steps.length - 1;
  return <div className="tour" role="dialog" aria-label={`Guided tour, step ${i + 1} of ${steps.length}`}>
    <div className="row"><small className="muted grow">Guided tour · step {i + 1} of {steps.length}</small><button className="btn sm ghost" onClick={() => onEnd(false)} aria-label="End the tour">✕</button></div>
    <div className="tour-prog"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
    <h3>{s.title}</h3><p>{s.text}</p>
    {s.say && <div className="tour-say"><span className="muted">Tap the 🎤 mic and say:</span><q>{s.say}</q></div>}
    <div className="row" style={{ flexWrap: "wrap" }}>
      {s.say && <button className="btn mint" disabled={busy} onClick={() => { onTry(s.say!); setTried(new Set([...tried, i])); }}>{tried.has(i) ? "✓ Try again" : "▶ Try it for me"}</button>}
      {s.actions?.map(([label, fn]) => <button key={label} className="btn mint" onClick={fn}>{label}</button>)}
      <span className="grow" />
      {i > 0 && <button className="btn sm ghost" onClick={() => setI(i - 1)}>‹ Back</button>}
      {last ? <button className="btn blue" onClick={() => onEnd(true)}>Finish</button> : <button className="btn blue" onClick={() => setI(i + 1)}>Next ›</button>}
    </div>
  </div>;
}
