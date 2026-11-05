import { useEffect, useRef, useState } from "react";
type P = { busy: string; onExport: (f: "pdf" | "word" | "markdown") => void; onImport: (files: File[]) => void; onImportDoc: (files: File[]) => void; onBackup: () => void };
/** "File" drop-down: export as PDF / Word / Markdown or a backup file; import a Word document, or a photo / PDF of notes. */
export default function FileMenu({ busy, onExport, onImport, onImportDoc, onBackup }: P) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null), pick = useRef<HTMLInputElement>(null), pickDoc = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }, k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); document.addEventListener("mousedown", h); window.addEventListener("keydown", k); return () => { document.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); }; }, [open]);
  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  return <div className="filemenu" ref={box}>
    <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} disabled={!!busy}>{busy ? <><span className="spinner" /> {busy}</> : "File ▾"}</button>
    {open && <div className="fm-pop" role="menu">
      <b className="fm-h">Export</b>
      <button role="menuitem" onClick={go(() => onExport("pdf"))}>📄 PDF</button><button role="menuitem" onClick={go(() => onExport("word"))}>📝 Word (.docx)</button><button role="menuitem" onClick={go(() => onExport("markdown"))}>⬇ Markdown (.md)</button>
      <button role="menuitem" onClick={go(onBackup)}>💾 Backup of this notebook</button>
      <hr /><b className="fm-h">Import</b>
      <button role="menuitem" onClick={go(() => pickDoc.current?.click())}>📝 Word document / Markdown / text…</button>
      <small className="muted">Headings, lists, bold/italic and tables come across as new sheets after this one.</small>
      <button role="menuitem" onClick={go(() => pick.current?.click())}>📷 Photo or PDF of notes…</button>
      <small className="muted">Handwriting and print are read by AI into new sheets after this one.</small>
    </div>}
    <input ref={pick} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) onImport(f); }} />
    <input ref={pickDoc} type="file" accept=".docx,.md,.markdown,.txt" multiple hidden onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) onImportDoc(f); }} />
  </div>;
}
