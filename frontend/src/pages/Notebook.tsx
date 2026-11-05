import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, askStream, speak, speakable, speechHooks, startSpeaker, stopSpeaking } from "../api";
import { useApp } from "../ctx";
const LANG_NAME: Record<string, string> = { "bn-IN": "Bengali", "gu-IN": "Gujarati", "hi-IN": "Hindi", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu", "en-IN": "English" };
import { createVoiceLoop, VoiceState } from "../voice";
import { buildLabelled, buildViz, VizResult as VR } from "../notebook/VisualizeDialog"; import FileMenu from "../notebook/FileMenu"; import VoiceSettings from "../notebook/VoiceSettings"; import { importFiles } from "../notebook/importing"; import StudyDialog, { StudyMode } from "../notebook/StudyDialog"; import ObjectLayer from "../notebook/ObjectLayer"; import SelectionBar from "../notebook/SelectionBar"; import SheetPanel from "../notebook/SheetPanel"; import MaterialsDialog, { Material, Coverage } from "../notebook/MaterialsDialog"; import LecturePanel, { LectureNotes } from "../notebook/LecturePanel"; import TourCard, { TourStep } from "../notebook/TourCard"; import VisualizeDialog, { VizResult } from "../notebook/VisualizeDialog";
import { Obj, PAGE_H, PAGE_W, Sheet, applyColor, applyFontSize, blankSheet, caretToEnd, currentFontSize, readImage, sanitize, textToHtml, uid, escHtml, blocksToHtml, groupIntoSheets, Block, sheetOutline, Reuse, headingText, setHeadingText, textKey, noteBoxHtml, mdToHtml, isNoteBox } from "../notebook/editing";

type Snap = { at: number; label: string; sheets: Sheet[]; title: string; active: number };
const TERM_STOP = new Set("This That These Those Then They There Here When What Which Where With From Also Each Some Many Most More Very Into Over Under After Before Because While Sheet Page Notes Note Unit Chapter Summary Heading Example Examples Also Other Every Their Your About".split(" "));
const copySheets = (a: Sheet[]): Sheet[] => a.map((x) => ({ id: x.id, html: x.html, objects: x.objects.map((o) => ({ ...o })) }));
const sameSheets = (a: Sheet[], b: Sheet[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.html === b[i].html && x.objects.length === b[i].objects.length
  && x.objects.every((o, k) => { const q = b[i].objects[k]; return o.id === q.id && o.x === q.x && o.y === q.y && o.w === q.w && o.h === q.h && o.src === q.src && o.alt === q.alt; }));
type Caption = { kind: "heard" | "ok" | "reply" | "error" | "info"; text: string; undo?: boolean } | null;
type Viz = { text: string; topic?: boolean; hint?: string; replace?: string; initial?: any } | null;
const HINTS = ["“Add a new sheet”", "“Go to sheet 2”", "“Replace the heading Speech Recognition with Speech Processing”", "“Change the current heading to Unit 2”", "“Organize my notes and remove the overlaps”", "“Add that to my notes” (after a Companion answer)", "“Read the selected text”", "“Delete this sheet” · “Delete the heading X” · “Delete this picture”", "“Undo” / “I didn’t mean that” · “Redo”", "“Add course material” (syllabus, slides, a chapter: the AI then knows the subject)", "“Record the lecture” (🎙 Lecture: a whole class → organized notes)", "“Turn this into a flowchart” (with text selected)", "“Draw a labelled diagram of the heart”", "“Show me how an amoeba looks”", "“Make the selected text red and bigger”", "“Summarize this notebook”", "“Quiz me” · “Make flashcards” · “What did I miss?”", "“What did I write about…?”", "“Read this sheet aloud” · “Stop”", "Anything else you say is written into the sheet."];

export default function Notebook() {
  const { id } = useParams(); const nav = useNavigate(); const [sp] = useSearchParams(); const { lang, languages, voice, status } = useApp();
  const [note, setNote] = useState<any>(null), [err, setErr] = useState(""), [saved, setSaved] = useState("saved");
  const sheetsRef = useRef<Sheet[]>([]), noteRef = useRef<any>(null), [, setVer] = useState(0), [thumbVer, setThumbVer] = useState(0), bump = () => setVer((v) => v + 1);
  const [active, setActive] = useState(0), activeRef = useRef(0); activeRef.current = active;
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("nb-panel") !== "0"), [companionOpen, setCompanionOpen] = useState(false), [hintsOpen, setHintsOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false), [typed, setTyped] = useState(""), [fileBusy, setFileBusy] = useState(""), [study, setStudy] = useState<{ mode: StudyMode; scope: "note" | "sheet" } | null>(null), [selObj, setSelObj] = useState<string | null>(null), [viz, setViz] = useState<Viz>(null), [k, setK] = useState(1);
  const ed = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), pageRef = useRef<HTMLDivElement>(null), titleRef = useRef<HTMLInputElement>(null), micRef = useRef<HTMLButtonElement>(null);
  const dirty = useRef(false), saveTimer = useRef<any>(0), pagTimer = useRef<any>(0), thTimer = useRef<any>(0), pendingCaret = useRef(false), caretRange = useRef<Range | null>(null), selRange = useRef<Range | null>(null);
  const lastText = useRef(0), history = useRef<Snap[]>([]), redoStack = useRef<Snap[]>([]), [, setHistVer] = useState(0);
  const [materials, setMaterials] = useState<Material[]>([]), [matOpen, setMatOpen] = useState(false), readId = useRef(0), [coverage, setCoverage] = useState<Coverage | null>(null);
  const [lectureOpen, setLectureOpen] = useState(false), [tour, setTour] = useState(false), [lecState, setLecState] = useState("idle");
  const [orgPreview, setOrgPreview] = useState<null | { say: string; items: { i: number; id: string; before: string; after: string }[] }>(null);
  const [voicePlaying, setVoicePlaying] = useState(false), [voiceNote, setVoiceNote] = useState(""), [confirmDel, setConfirmDel] = useState<null | { text: string; at: number; run: () => Promise<void> }>(null);
  // voice + companion
  const [voiceState, setVoiceState] = useState<VoiceState>("off"), [processing, setProcessing] = useState(false), [assistantSpeaking, setAssistantSpeaking] = useState(false), [caption, setCaption] = useState<Caption>(null);
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem("voiceReplies") !== "0"), loopRef = useRef<ReturnType<typeof createVoiceLoop> | null>(null), blockRef = useRef(false), latest = useRef<any>({});
  const [sid, setSid] = useState<number | null>(null), [msgs, setMsgs] = useState<any[]>([]), [stream, setStream] = useState(""), [chatBusy, setChatBusy] = useState(false), [chatText, setChatText] = useState(""), [chatErr, setChatErr] = useState(""), chatEnd = useRef<HTMLDivElement>(null);
  noteRef.current = note ?? noteRef.current;

  // ---------- saving ----------
  const syncEditor = () => { const s = sheetsRef.current[activeRef.current]; if (s && ed.current) s.html = ed.current.innerHTML; };
  async function saveNow() {
    const n = noteRef.current; if (!n) return; clearTimeout(saveTimer.current); syncEditor();
    const mine = sheetsRef.current; dirty.current = false; setSaved("saving…");
    try { await api("/notes/" + n.id, { method: "PUT", json: { title: n.title, language: n.language, sheets: mine } }); if (!dirty.current) setSaved("saved"); }
    catch (e: any) { dirty.current = true; setSaved("not saved"); setErr("Couldn't save: " + e.message); }
  }
  const markDirty = () => { dirty.current = true; setSaved("unsaved…"); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(saveNow, 900); };
  const bumpThumbs = () => { clearTimeout(thTimer.current); thTimer.current = setTimeout(() => setThumbVer((v) => v + 1), 450); };
  const setMeta = (p: any) => { noteRef.current = { ...noteRef.current, ...p }; setNote(noteRef.current); markDirty(); };
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, []);
  useEffect(() => () => { clearTimeout(pagTimer.current); if (dirty.current && noteRef.current) saveNow(); loopRef.current?.stop(); stopSpeaking(); }, []);

  // ---------- loading ----------
  useEffect(() => {
    let off = false;
    (async () => {
      if (dirty.current && noteRef.current) await saveNow();
      setNote(null); noteRef.current = null; setErr(""); setSid(null); setMsgs([]); setStream("");
      try {
        const x = await api("/notes/" + id); if (off) return;
        sheetsRef.current = (x.sheets || []).map((s: any) => ({ id: s.id, html: s.html || "", objects: s.objects || [] }));
        if (!sheetsRef.current.length) sheetsRef.current = [blankSheet()];
        noteRef.current = x; setNote(x); setActive(0); setSelObj(null); setSaved("saved"); bump(); setThumbVer((v) => v + 1);
        history.current = []; redoStack.current = []; setMaterials([]); setCoverage(null); api(`/notes/${x.id}/materials`).then((m) => { if (!off) setMaterials(m); }).catch(() => {});
        api(`/notes/${x.id}/coverage`).then((c) => { if (!off && c?.total) setCoverage(c); }).catch(() => {});
      } catch (e: any) { if (!off) setErr(e.message); }
    })();
    return () => { off = true; };
  }, [id]);
  const activeId = sheetsRef.current[active]?.id;
  useLayoutEffect(() => {
    const el = ed.current, s = sheetsRef.current[active]; if (!el || !s) return;
    el.innerHTML = sanitize(s.html) || "<p><br></p>"; el.classList.remove("scroll"); setSelObj(null);
    if (pendingCaret.current) { pendingCaret.current = false; el.focus(); caretToEnd(el); }
    requestAnimationFrame(paginate);
  }, [note?.id, activeId]);
  useEffect(() => { if (note && sp.get("new") && !sp.get("tour")) titleRef.current?.select(); }, [note?.id]);
  useEffect(() => { if (note && sp.get("tour")) setTour(true); }, [note?.id]);
  useEffect(() => { const el = stage.current; if (!el) return; const ro = new ResizeObserver(() => setK(Math.min(1, Math.max(0.3, (el.clientWidth - 56) / (PAGE_W + 14))))); ro.observe(el); return () => ro.disconnect(); }, [note?.id, panelOpen, companionOpen]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs, stream]);
  useEffect(() => { // remember the caret and the last real selection even after focus moves to the mic
    const h = () => { const el = ed.current, s = window.getSelection(); if (!el || !s || !s.rangeCount) return; const r = s.getRangeAt(0); if (!el.contains(r.startContainer)) return; caretRange.current = r.cloneRange(); selRange.current = s.isCollapsed ? null : r.cloneRange(); };
    document.addEventListener("selectionchange", h); return () => document.removeEventListener("selectionchange", h);
  }, []);
  useEffect(() => { if (!caption || processing || chatBusy) return; const t = setTimeout(() => setCaption(null), caption.kind === "error" ? 9000 : 6500); return () => clearTimeout(t); }, [caption, processing, chatBusy]);

  // ---------- sheets ----------
  const sheets = sheetsRef.current, cur = sheets[active];
  const goTo = (i: number) => { const n = sheetsRef.current.length; i = Math.max(0, Math.min(n - 1, i)); if (i === activeRef.current) return; syncEditor(); setActive(i); };
  const addSheet = (html?: string, focus = true) => { syncEditor(); const at = activeRef.current + 1; sheetsRef.current.splice(at, 0, blankSheet(html)); pendingCaret.current = focus; markDirty(); bump(); bumpThumbs(); setActive(at); return at + 1; };
  const duplicateSheet = (i: number) => { syncEditor(); const s = sheetsRef.current[i]; sheetsRef.current.splice(i + 1, 0, { id: uid(), html: s.html, objects: s.objects.map((o) => ({ ...o, id: uid() })) }); markDirty(); bump(); bumpThumbs(); setActive(i + 1); };
  const deleteSheet = (i: number) => {
    syncEditor(); const s = sheetsRef.current[i], has = s.html.replace(/<[^>]+>/g, "").trim() || s.objects.length;
    if (has && !confirm(`Delete sheet ${i + 1}? Its text and images will be removed. (You can undo this.)`)) return;
    checkpoint(`deleting sheet ${i + 1}`); removeSheet(i);
  };
  const removeSheet = (i: number) => {
    if (sheetsRef.current.length === 1) sheetsRef.current[0] = blankSheet(); else sheetsRef.current.splice(i, 1);
    const a = activeRef.current; setActive(i < a ? a - 1 : Math.min(a, sheetsRef.current.length - 1)); setSelObj(null); markDirty(); bump(); bumpThumbs();
  };
  const moveSheet = (from: number, to: number) => { syncEditor(); const id0 = sheetsRef.current[activeRef.current].id; const [s] = sheetsRef.current.splice(from, 1); sheetsRef.current.splice(to, 0, s); setActive(sheetsRef.current.findIndex((x) => x.id === id0)); markDirty(); bump(); bumpThumbs(); };
  /** When text runs past the bottom of the sheet, the overflow moves on to the next sheet (a new one is created if needed), like pages in a document. */
  function paginate() {
    const el = ed.current, i = activeRef.current, all = sheetsRef.current; if (!el || !el.clientHeight || !all[i]) return;
    if (el.scrollHeight <= el.clientHeight + 2) { el.classList.remove("scroll"); return; }
    const anchor = window.getSelection()?.anchorNode, moved: Node[] = [];
    while (el.scrollHeight > el.clientHeight + 2 && el.childNodes.length > 1) { moved.unshift(el.lastChild!); el.removeChild(el.lastChild!); }
    el.classList.toggle("scroll", el.scrollHeight > el.clientHeight + 2); if (!moved.length) return;
    const caretMoved = !!anchor && moved.some((n) => n === anchor || n.contains(anchor)), box = document.createElement("div"); moved.forEach((n) => box.appendChild(n));
    all[i].html = el.innerHTML; if (all[i + 1]) all[i + 1].html = box.innerHTML + all[i + 1].html; else all.splice(i + 1, 0, blankSheet(box.innerHTML));
    markDirty(); bump(); bumpThumbs(); if (caretMoved) { pendingCaret.current = true; setActive(i + 1); }
  }
  const onInput = () => { syncEditor(); markDirty(); bumpThumbs(); clearTimeout(pagTimer.current); pagTimer.current = setTimeout(paginate, 450); };

  // ---------- objects (images, visuals) ----------
  const freeSpot = (w: number, h: number) => { const el = ed.current; let y = 110; const last = el?.lastElementChild as HTMLElement | null; if (last && last.textContent?.trim()) y = last.offsetTop + last.offsetHeight + 24; return { x: Math.round((PAGE_W - w) / 2), y: Math.round(Math.max(40, Math.min(y, PAGE_H - h - 40))) }; };
  const addObj = (o: Omit<Obj, "id">) => { const obj = { ...o, id: uid() }; sheetsRef.current[activeRef.current].objects.push(obj); setSelObj(obj.id); markDirty(); bump(); bumpThumbs(); return obj; };
  const patchObj = (oid: string, p: Partial<Obj>) => { const o = sheetsRef.current[activeRef.current]?.objects.find((x) => x.id === oid); if (!o) return; Object.assign(o, p); markDirty(); bump(); bumpThumbs(); };
  const deleteObj = (oid: string) => { checkpoint("deleting the picture"); const s = sheetsRef.current[activeRef.current]; s.objects = s.objects.filter((o) => o.id !== oid); setSelObj(null); markDirty(); bump(); bumpThumbs(); };
  // copy / cut / paste a picture or visual, also onto a different sheet
  const [hasClip, setHasClip] = useState(false), objClip = useRef<Omit<Obj, "id"> | null>(null);
  const copyObj = (oid: string, cut = false) => { const o = sheetsRef.current[activeRef.current]?.objects.find((x) => x.id === oid); if (!o) return; const { id, ...rest } = o; objClip.current = JSON.parse(JSON.stringify(rest)); setHasClip(true); if (cut) deleteObj(oid); say(cut ? "Cut. Go to any sheet and press Ctrl+V (or Paste)." : "Copied. Go to any sheet and press Ctrl+V (or Paste).", "info"); };
  const pasteObj = () => { const c = objClip.current; if (!c) return; const here = sheetsRef.current[activeRef.current].objects.some((o) => Math.abs(o.x - c.x) < 6 && Math.abs(o.y - c.y) < 6 && o.src === c.src); checkpoint("pasting the visual"); addObj({ ...JSON.parse(JSON.stringify(c)), x: c.x + (here ? 28 : 0), y: c.y + (here ? 28 : 0) }); };
  async function addImages(files: File[], at?: { x: number; y: number }) {
    for (const f of files.filter((f) => f.type.startsWith("image/"))) {
      try { const im = await readImage(f), w = Math.min(im.w, 380), h = Math.round((w * im.h) / im.w), spot = at ? { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) } : freeSpot(w, h); addObj({ kind: "image", src: im.src, alt: f.name.replace(/\.[^.]+$/, ""), w, h, ...spot }); }
      catch (e: any) { setErr(e.message); }
    }
  }
  const pagePoint = (e: React.DragEvent) => { const r = pageRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
  function insertViz(r: VizResult) {
    checkpoint(viz?.replace ? "restyling the visual" : "inserting the visual"); const rep = viz?.replace, w = Math.min(r.w, r.meta?.mode === "labelled" ? 700 : 560), h = Math.round((w * r.h) / r.w);
    if (rep) { const o = sheetsRef.current[activeRef.current].objects.find((x) => x.id === rep); if (o) { o.src = r.src; o.alt = r.alt; o.meta = r.meta; o.h = Math.round((o.w * r.h) / r.w); markDirty(); bump(); bumpThumbs(); } }
    else addObj({ kind: "visual", src: r.src, alt: r.alt, meta: r.meta, w, h, ...freeSpot(w, h) });
    setViz(null);
  }

  // ---------- text actions ----------
  const withSel = (r: Range | null, fn: () => void) => { const el = ed.current; if (!el || !r) return false; el.focus(); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r); fn(); onInput(); return true; };
  function insertText(text: string) {
    const el = ed.current; if (!el) return; el.focus(); const s = window.getSelection()!, r = caretRange.current;
    if (r && el.contains(r.startContainer)) { const c = r.cloneRange(); c.collapse(false); s.removeAllRanges(); s.addRange(c); } else caretToEnd(el);
    const parts = text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      const a = window.getSelection()!.anchorNode, para = (a?.nodeType === 3 ? a.parentElement : (a as Element | null))?.closest("p,li,h2,div");
      if (i > 0 || (para && para !== el && (para.textContent || "").length > 600)) document.execCommand("insertParagraph");
      const n = window.getSelection()!.anchorNode, o = window.getSelection()!.anchorOffset, prev = n?.nodeType === 3 && o > 0 ? (n.textContent || "")[o - 1] : "";
      document.execCommand("insertText", false, (prev && !/\s/.test(prev) ? " " : "") + p);
    });
    onInput();
  }
  const selText = () => (selRange.current?.toString() || window.getSelection()?.toString() || "").trim();
  const sheetText = () => (ed.current?.innerText || "").trim();
  function pasteHandler(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); void addImages(files); return; }
    e.preventDefault(); const t = e.clipboardData.getData("text/plain"); if (!t) return;
    const lines = t.split(/\r?\n+/).filter((l) => l.trim()); if (lines.length < 2) document.execCommand("insertText", false, t); else document.execCommand("insertHTML", false, lines.map((l) => `<p>${escHtml(l)}</p>`).join(""));
    onInput();
  }

  async function doExport(fmt: "pdf" | "word" | "markdown") {
    syncEditor(); const t = noteRef.current?.title || "Notebook", all = sheetsRef.current.map((x) => ({ ...x })); setFileBusy(fmt === "pdf" ? "Making PDF…" : "Exporting…"); setErr("");
    try {
      const ex = await import("../notebook/exporters");
      if (fmt === "pdf") await ex.exportPdf(t, all, (i, n) => setFileBusy(`PDF ${i}/${n}…`)); else if (fmt === "word") await ex.exportDocx(t, all); else await ex.exportMarkdown(t, all);
      say(`Saved “${t}” as ${fmt === "pdf" ? "a PDF" : fmt === "word" ? "a Word file" : "Markdown"}. Check your downloads.`);
    } catch (e: any) { setErr("Couldn't export: " + (e?.message || e)); say("Export failed.", "error"); } finally { setFileBusy(""); }
  }
  async function doImportDoc(files: File[]) {
    syncEditor(); setErr(""); const probs: string[] = []; let total = 0, at = activeRef.current + 1;
    for (const f of files) {
      setFileBusy(`Importing ${f.name}…`); const fd = new FormData(); fd.append("file", f);
      try {
        const r = await api("/import/document", { method: "POST", body: fd }); if (!total) checkpoint("the import");
        sheetsRef.current.splice(at, 0, ...r.sheets.map((h: string) => blankSheet(h))); at += r.sheets.length; total += r.sheets.length; (r.problems || []).forEach((x: string) => probs.push(`${f.name}: ${x}`));
      } catch (e: any) { probs.push(`${f.name}: ${e.message}`); }
    }
    setFileBusy("");
    if (total) { markDirty(); bump(); bumpThumbs(); setActive(at - total); setPanelOpen(true); say(`Imported ${total} sheet${total === 1 ? "" : "s"}. Undo takes it back.`, "ok", true); }
    if (probs.length) setErr(probs.join("  ·  "));
  }
  async function doBackup() { if (dirty.current) await saveNow(); const a = document.createElement("a"); a.href = `/api/backup/export?note_id=${noteRef.current.id}`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); say("Downloading a backup of this notebook. Restore it from the home page (Restore backup).", "info"); }
  /** Lecture notes go onto new sheets after this one (or onto this sheet if it is empty), spread out like pages. */
  function insertLecture(r: LectureNotes, transcript: string, keep: boolean) {
    checkpoint("the lecture notes"); syncEditor();
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const blocks: Block[] = [{ type: "heading", text: r.title || "Lecture notes", tag: date }, ...(r.blocks || [])];
    if (r.key_terms?.length) blocks.push({ type: "heading", text: "Key terms" }, { type: "bullets", items: r.key_terms.map((t) => `${t.term}: ${t.meaning}`) });
    if (r.follow_up?.length) blocks.push({ type: "heading", text: "To review or ask" }, { type: "bullets", items: r.follow_up });
    const pages = groupIntoSheets(blocks);
    if (keep && transcript.trim()) {
      const paras = transcript.match(/[^.!?।]+[.!?।]*\s*/g) || [transcript]; let cur = `<h2 style="font-size:26px">Lecture transcript · ${escHtml(date)}</h2>`, size = 0, para = "";
      const flushPara = () => { if (para.trim()) { cur += `<p>${escHtml(para.trim())}</p>`; size += para.length; para = ""; } };
      for (const sn of paras) { para += sn; if (para.length > 500) flushPara(); if (size > 1600) { pages.push(cur); cur = ""; size = 0; } }
      flushPara(); if (cur) pages.push(cur);
    }
    const i = activeRef.current, here = sheetsRef.current[i], empty = !(ed.current?.innerText || "").trim() && !here.objects.length;
    const at = empty ? i : i + 1; if (empty) sheetsRef.current.splice(i, 1);
    sheetsRef.current.splice(at, 0, ...pages.map((h) => blankSheet(h)));
    if (ed.current && empty) ed.current.innerHTML = sanitize(sheetsRef.current[i].html);
    markDirty(); bump(); bumpThumbs(); setActive(at); setPanelOpen(true); setLectureOpen(false);
    say(`${r.say || "Made your lecture notes."} ${pages.length} sheet${pages.length === 1 ? "" : "s"}, from sheet ${at + 1}.`, "ok", true);
  }
  async function doImport(files: File[]) {
    syncEditor(); setFileBusy("Importing…"); setErr("");
    try {
      const { sheets: htmls, problems } = await importFiles(files, (m) => say(m, "info"));
      if (htmls.length) {
        checkpoint("the import"); const at = activeRef.current + 1; sheetsRef.current.splice(at, 0, ...htmls.map((h) => blankSheet(h))); markDirty(); bump(); bumpThumbs(); setActive(at); setPanelOpen(true);
        say(`Imported ${htmls.length} sheet${htmls.length === 1 ? "" : "s"} (from sheet ${at + 1}). Please read through: handwriting recognition can slip.`);
      } else say("Nothing was imported.", "error");
      if (problems.length) setErr(problems.join("  ·  "));
    } catch (e: any) { setErr("Couldn't import: " + (e?.message || e)); } finally { setFileBusy(""); }
  }
  /** "Put a heading ..., a summary and a diagram of ..." — the AI plans blocks; text goes in at once, diagrams are drawn and placed below the text. */
  async function runCompose(instruction: string) {
    const e0 = ed.current; if (!e0) return; say(/question|answer|example|code|exercise/i.test(instruction) ? "Writing your study material… (a set of questions with code takes up to a minute)" : "Working out what to write…", "info"); if (dirty.current) await saveNow(); syncEditor();
    const r = await api("/voice/compose", { json: { instruction, note_id: noteRef.current.id, sheet_index: activeRef.current + 1, sheet_count: sheetsRef.current.length, selection: selText(), sheet_tail: sheetText() } });
    const blocks: any[] = r.blocks || []; if (!blocks.length) { say(r.say || "I wasn't sure what to add. Could you say it a bit differently?", "info"); return; }
    const idx = activeRef.current, nBefore = sheetsRef.current.length, empty = !e0.innerText.trim();
    const textBlocks = blocks.filter((b) => b.type !== "visual"), html = blocksToHtml(textBlocks);
    const long = textBlocks.length > 10 || textBlocks.some((b) => b.type === "code" || b.type === "question");
    if (html && long) {          // study material (questions, code): its own sheets after this one, spread like pages
      const pages = groupIntoSheets(textBlocks, 1400), at = empty && !sheetsRef.current[idx].objects.length ? idx : idx + 1;
      if (at === idx) sheetsRef.current.splice(idx, 1);
      sheetsRef.current.splice(at, 0, ...pages.map((h) => blankSheet(h))); if (ed.current && at === idx) ed.current.innerHTML = sanitize(sheetsRef.current[idx].html);
      markDirty(); bump(); bumpThumbs(); setActive(at); setPanelOpen(true);
      say(`${r.say || "Done."} ${pages.length} sheet${pages.length === 1 ? "" : "s"}, from sheet ${at + 1}.`, "ok"); return;
    }
    if (html) { if (empty) e0.innerHTML = html; else e0.insertAdjacentHTML("beforeend", html); syncEditor(); paginate(); markDirty(); bump(); bumpThumbs(); }
    const added = sheetsRef.current.length - nBefore, last = e0.lastElementChild as HTMLElement | null;
    let target = idx + added, y: number | null = added ? null : (last ? last.offsetTop + last.offsetHeight + 24 : 90), placed = 0, failed = "";
    for (const b of blocks.filter((x) => x.type === "visual")) {
      say(b.mode === "labelled" ? "Drawing the labelled diagram…" : "Drawing the diagram…", "info");
      try {
        let v: VR;
        if (b.mode === "labelled") v = buildLabelled((await api("/visuals/labelled", { json: { subject: b.topic } })).figure, "notebook", "pastel", true);
        else { const sp = (await api("/visuals/generate", { json: { text: b.topic, topic: true, hint: b.kind || "" } })).spec; v = buildViz(sp, b.kind && sp.kinds.includes(b.kind) ? b.kind : sp.kinds[0], "notebook", "pastel", true); }
        const w = Math.min(v.w, 650), h = Math.round((w * v.h) / v.w);
        if (y === null || y + h > PAGE_H - 50) { sheetsRef.current.splice(target + 1, 0, blankSheet()); target++; y = 90; }
        sheetsRef.current[target].objects.push({ id: uid(), kind: "visual", src: v.src, alt: v.alt, meta: v.meta, w, h, x: Math.round((PAGE_W - w) / 2), y });
        y += h + 24; placed++; markDirty(); bump(); bumpThumbs();
      } catch (e: any) { failed = e.message; }
    }
    const where = target !== idx ? ` The diagram is on sheet ${target + 1}.` : "";
    say(failed ? `${r.say || "Added the text."} I couldn't draw the diagram: ${failed}` : (r.say || "Done.") + where, failed ? "info" : "ok");
  }
  // ---------- undo / redo history: every change made by voice, a typed command, or a button is recorded (20 steps) ----------
  const snapNow = (label: string): Snap => { syncEditor(); return { at: Date.now(), label, sheets: copySheets(sheetsRef.current), title: noteRef.current?.title || "", active: activeRef.current }; };
  const pushHist = (s: Snap) => { const h = history.current, top = h[h.length - 1]; if (top && top.title === s.title && sameSheets(top.sheets, s.sheets)) return; h.push(s); if (h.length > 20) h.shift(); redoStack.current = []; setHistVer((v) => v + 1); };
  /** Call just before changing the notebook from the UI. */
  const checkpoint = (label: string) => pushHist(snapNow(label));
  const commitIfChanged = (before: Snap) => { const now = snapNow(before.label); if (now.title === before.title && sameSheets(now.sheets, before.sheets)) return false; before.at = Date.now(); pushHist(before); return true; };
  const restoreSnap = (s: Snap) => {
    sheetsRef.current = copySheets(s.sheets); if (noteRef.current && noteRef.current.title !== s.title) { noteRef.current = { ...noteRef.current, title: s.title }; setNote(noteRef.current); }
    const a = Math.min(s.active, sheetsRef.current.length - 1); if (ed.current) ed.current.innerHTML = sanitize(sheetsRef.current[a].html) || "<p><br></p>"; setActive(a); setSelObj(null); markDirty(); bump(); bumpThumbs();
  };
  function doUndo() {
    if (assistantSpeaking) { stopSpeaking(); blockRef.current = false; setAssistantSpeaking(false); }
    const h = history.current, top = h[h.length - 1];
    if (ed.current && lastText.current && (!top || lastText.current > top.at)) { lastText.current = 0; ed.current.focus(); if (document.queryCommandEnabled("undo") && document.execCommand("undo")) { onInput(); say("Undid your last typing. Undo again to go further back.", "ok"); return; } }
    if (!top) { say("There's nothing to undo.", "info"); return; }
    redoStack.current.push(snapNow(top.label)); h.pop(); restoreSnap(top); setHistVer((v) => v + 1);
    say(`Undone: ${top.label}.${h.length ? " Say “undo” again to go further back." : ""}`, "ok");
  }
  function doRedo() {
    const r = redoStack.current.pop(); if (!r) { say("There's nothing to redo.", "info"); return; }
    history.current.push(snapNow(r.label)); restoreSnap(r); setHistVer((v) => v + 1); say(`Redone: ${r.label}.`, "ok");
  }
  const short = (t: string) => { t = t.replace(/\s+/g, " ").trim(); return t.length > 60 ? t.slice(0, 57) + "…" : t; };
  /** Runs fn on a sheet's DOM: the live editor for the open sheet, a detached copy for the others (written back when fn changed something). */
  const onSheet = (i: number, fn: (root: HTMLElement) => boolean) => {
    if (i === activeRef.current && ed.current) return fn(ed.current);
    const t = document.createElement("div"); t.innerHTML = sanitize(sheetsRef.current[i].html); const ch = fn(t); if (ch) sheetsRef.current[i].html = t.innerHTML; return ch;
  };
  const headingsOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4")).filter((h) => !h.closest("[data-ai-note]") && headingText(h));
  /** "Replace the (current) heading X with Y" / "replace X with Y": change words that are already in the notes. */
  function editText(a: { what?: string; target?: string; replacement?: string }, erase = false) {
    const rep = String(a.replacement || "").trim(), target = String(a.target || "").trim(); if (!rep && !erase) { say("What should the new wording be?", "info"); return; }
    syncEditor(); const idx = activeRef.current, order = [idx, ...sheetsRef.current.map((_, i) => i).filter((i) => i !== idx)];
    const done = (msg: string, sheet: number) => { syncEditor(); markDirty(); bump(); bumpThumbs(); if (sheet !== idx) goTo(sheet); say(msg, "ok", true); };
    const current = !target || /^(this|that|it|the|current|first|main|top|particular|existing|this current|the current)?\s*(heading|headin|title)?$/i.test(target);
    if (a.what !== "text") {
      if (current) { // the heading the caret is in, else the nearest one above the caret, else the first one on the sheet
        const hs = headingsOf(ed.current!); if (!hs.length) { say(`There's no heading on sheet ${idx + 1} to replace. Select a line and say “make this a heading” first.`, "info"); return; }
        const c = caretRange.current?.startContainer; let h = hs.find((x) => c && x.contains(c));
        if (!h && c && ed.current!.contains(c)) h = [...hs].reverse().find((x) => x.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        h = h || hs[0]; const old = headingText(h); setHeadingText(h, rep); done(`Changed the heading “${old}” to “${rep}”.`, idx); return;
      }
      const want = textKey(target), wantW = want.split(" ").filter(Boolean); let best: { i: number; old: string; s: number } | null = null;
      for (const i of order) onSheet(i, (root) => { for (const h of headingsOf(root)) { const k = textKey(headingText(h)), s = k === want ? 3 : k.includes(want) || want.includes(k) ? 2 : wantW.filter((w) => k.split(" ").includes(w)).length / Math.max(1, wantW.length) >= 0.6 ? 1 : 0; if (s && (!best || s > best.s)) best = { i, old: headingText(h), s }; } return false; });
      if (best) { const b = best as { i: number; old: string }; onSheet(b.i, (root) => { const h = headingsOf(root).find((x) => headingText(x) === b.old); if (h) setHeadingText(h, rep); return !!h; }); done(`Changed the heading “${b.old}” to “${rep}”${b.i !== idx ? ` on sheet ${b.i + 1}` : ""}.`, b.i); return; }
      // no heading matched: fall through and look for the words anywhere
    }
    if (current) { say("Which words should I replace? Say “replace X with Y”.", "info"); return; }
    const re = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    const replaceIn = (root: HTMLElement) => { let n = 0; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = []; while (w.nextNode()) nodes.push(w.currentNode as Text); for (const t of nodes) { const v = t.data; let nv = v.replace(re, () => (n++, rep)); if (erase) nv = nv.replace(/ {2,}/g, " ").replace(/ ([,.;:!?])/g, "$1"); if (nv !== v) t.data = nv; } return n; };
    for (const i of order) { let n = 0; onSheet(i, (root) => (n = replaceIn(root)) > 0); if (n) { done(`${erase ? `Deleted “${target}”` : `Replaced “${target}” with “${rep}”`} ${n === 1 ? "once" : n + " times"}${i !== idx ? ` on sheet ${i + 1}` : ""}.`, i); return; } }
    say(`I couldn't find “${target}” in this notebook.`, "info");
  }
  /** "Organize my notes, remove the overlaps": the AI regroups the text; lines it keeps unchanged keep their formatting, Companion boxes and pictures stay. */
  async function organize(scope: "sheet" | "note") {
    syncEditor(); if (dirty.current) await saveNow();
    const idx = activeRef.current, idxs = scope === "sheet" ? [idx] : sheetsRef.current.map((_, i) => i), reuse: Reuse = { orig: new Map(), boxes: [], used: new Set() };
    const payload = idxs.map((i) => ({ sheet: i + 1, outline: sheetOutline(sheetsRef.current[i].html, i, reuse) })).filter((s) => s.outline.trim());
    if (!payload.length) { say("There's nothing to organize yet.", "info"); return; }
    say(scope === "sheet" ? `Organizing sheet ${idx + 1}…` : `Organizing all ${idxs.length} sheets…`, "info");
    const r = await api("/voice/organize", { json: { title: noteRef.current?.title, note_id: noteRef.current?.id, scope, sheets: payload } });
    syncEditor(); const after = new Map<number, string>();
    for (const s of r.sheets || []) { const i = s.sheet - 1; if (!payload.some((p) => p.sheet === s.sheet)) continue; after.set(i, blocksToHtml(s.blocks || [], reuse) || "<p><br></p>"); }
    reuse.boxes.forEach((b, n) => { if (!reuse.used.has(n)) after.set(b.sheet, (after.get(b.sheet) ?? sheetsRef.current[b.sheet].html) + b.html); });     // a box the AI forgot is never lost
    const items = [...after.entries()].sort((a, b) => a[0] - b[0]).map(([i, html]) => ({ i, id: sheetsRef.current[i].id, before: sheetsRef.current[i].html, after: html }));
    if (!items.length) { say("The AI didn't suggest any changes.", "info"); return; }
    setOrgPreview({ say: r.say || "Organized your notes.", items }); say("Here's the organized version. Check it, then Apply or Cancel.", "info");
  }
  /** Apply the previewed organize (only to sheets that still exist and haven't been changed since). */
  function applyOrganize() {
    const pv = orgPreview; if (!pv) return; setOrgPreview(null); syncEditor(); checkpoint("organizing the notes"); let n = 0, skipped = 0;
    for (const it of pv.items) { const k = sheetsRef.current.findIndex((x) => x.id === it.id); if (k < 0) continue; if (sheetsRef.current[k].html !== it.before) { skipped++; continue; } sheetsRef.current[k].html = it.after; n++; }
    if (ed.current) { ed.current.innerHTML = sanitize(sheetsRef.current[activeRef.current].html) || "<p><br></p>"; requestAnimationFrame(paginate); }
    markDirty(); bump(); bumpThumbs();
    say(`${pv.say}${skipped ? ` (${skipped} sheet${skipped === 1 ? "" : "s"} you edited meanwhile ${skipped === 1 ? "was" : "were"} left as is.)` : ""}`, "ok", n > 0);
  }
  const cancelOrganize = () => { setOrgPreview(null); say("Okay, I kept your notes exactly as they were.", "info"); };
  /** Companion output (answer, summary, quiz…) goes into the sheet as a small boxed note, after the paragraph the caret is in. */
  function addNoteBox(label: string, inner: string) {
    const el = ed.current; if (!el) return; checkpoint("adding the note box"); const idx = activeRef.current;
    const t = document.createElement("template"); t.innerHTML = sanitize(noteBoxHtml(label, inner)); const box = t.content.firstElementChild!;
    if (!el.innerText.trim() && !el.querySelector("img,[data-ai-note]")) { el.innerHTML = ""; el.appendChild(box); }
    else { const r = caretRange.current; let n: Node | null = r && el.contains(r.startContainer) ? r.startContainer : null; while (n && n.parentNode !== el) n = n.parentNode; if (n) el.insertBefore(box, n.nextSibling); else el.appendChild(box); }
    if (!box.nextElementSibling || isNoteBox(box.nextElementSibling)) box.insertAdjacentHTML("afterend", "<p><br></p>");   // room to keep writing below it
    syncEditor(); markDirty(); bump(); bumpThumbs(); requestAnimationFrame(paginate);
    say(`Added to sheet ${idx + 1} as a note box.`, "ok", true);
  }
  const boxLabel = (prompt = "") => /summar/i.test(prompt) ? "Summary" : /quiz|test me/i.test(prompt) ? "Quiz" : /flash ?cards?/i.test(prompt) ? "Flashcards" : /explain/i.test(prompt) ? "Explanation" : "Companion note";
  const addReplyToNotes = (i?: number) => {
    const all = msgs; let k = i ?? all.map((m) => m.role).lastIndexOf("assistant"); if (k < 0 || all[k]?.role !== "assistant") { say("There's no Companion answer to add yet. Ask something first.", "info"); return; }
    const q = [...all.slice(0, k)].reverse().find((m) => m.role === "user")?.content || ""; addNoteBox(boxLabel(q), mdToHtml(all[k].content));
  };
  /** Read text aloud; pressing again while it speaks stops it. */
  async function readText(text: string, inLang = "") {
    if (assistantSpeaking) { readId.current++; stopSpeaking(); blockRef.current = false; setAssistantSpeaking(false); return; }
    if (!text.trim()) { say("There's nothing to read yet.", "info"); return; }
    const my = ++readId.current; blockRef.current = true; setAssistantSpeaking(true);
    try {
      if (inLang && inLang !== "en-IN") { say(`Putting it into ${LANG_NAME[inLang] || "your language"}…`, "info"); text = (await api("/translate", { json: { text: text.slice(0, 4000), to: inLang } })).text; if (my !== readId.current) return; }
      say("Reading aloud… (tap the mic or ■ to stop)", "info");
      await speak(text, voice, undefined, inLang && inLang !== "en-IN" ? inLang : "auto"); if (my === readId.current) setCaption((c) => (c?.text.startsWith("Reading aloud") ? null : c)); }
    catch (e: any) { if (my === readId.current) say(e.message, "error"); }
    finally { setTimeout(() => { if (my === readId.current) { blockRef.current = false; setAssistantSpeaking(false); } }, 400); }   // only the latest reading clears the state
  }
  /** Delete by voice. Everything except a whole notebook goes into the undo history, so no confirmation is needed. */
  async function doDelete(a: { what?: string; target?: string; kind?: string }) {
    const i = activeRef.current, n = sheetsRef.current.length, t = String(a.target || "").trim(), tl = t.toLowerCase(), kind = a.kind || "";
    if (a.what === "sheet") {
      const k = !tl || /^(this|that|current|the current|this current)$/.test(tl) ? i : tl === "last" ? n - 1 : tl === "first" ? 0 : tl === "next" ? i + 1 : tl === "previous" ? i - 1 : Number(tl) - 1;
      if (!Number.isInteger(k) || k < 0 || k >= n) { say(`There's no sheet ${t}. This notebook has ${n}.`, "info"); return; }
      syncEditor(); removeSheet(k); say(n === 1 ? "Cleared the only sheet." : `Deleted sheet ${k + 1}.`, "ok", true); return;
    }
    if (a.what === "selection") {
      const r = selRange.current, txt = r?.toString().trim(); if (!r || !txt) { say("Select the text you want to delete first.", "info"); return; }
      withSel(r, () => document.execCommand("delete")); selRange.current = null; say(`Deleted “${short(txt)}”.`, "ok", true); return;
    }
    if (a.what === "picture") {
      const objs = sheetsRef.current[i].objects; let o = selObj ? objs.find((x) => x.id === selObj) : undefined;
      if (!o && tl === "last") o = objs[objs.length - 1]; if (!o && tl === "first") o = objs[0];
      if (!o && t && !/^(this|that|it)$/.test(tl)) { const w = textKey(t).split(" ").filter(Boolean); o = objs.map((x) => ({ x, s: w.filter((q) => textKey(x.alt).includes(q)).length })).sort((p, q) => q.s - p.s).find((p) => p.s > 0)?.x; }
      if (!o && objs.length === 1) o = objs[0];
      if (!o) { say(objs.length ? `There are ${objs.length} pictures on this sheet. Click the one to delete, then say “delete this”.` : "There's no picture on this sheet.", "info"); return; }
      deleteObj(o.id); say(`Deleted the picture${o.alt ? ` “${short(o.alt)}”` : ""}.`, "ok", true); return;
    }
    if (a.what === "words") { if (!t) { say("Which words should I delete?", "info"); return; } editText({ what: "text", target: t, replacement: "" }, true); return; }
    if (a.what === "notebook") {
      const title = noteRef.current?.title || "this notebook";
      setConfirmDel({ text: `Delete the whole notebook “${title}” for good? This one can't be undone.`, at: Date.now(), run: async () => { dirty.current = false; clearTimeout(saveTimer.current); await api("/notes/" + noteRef.current.id, { method: "DELETE" }); nav("/"); } });
      say("Say “yes, delete it” or press Delete notebook to confirm. Anything else cancels.", "info"); return;
    }
    // a whole heading / paragraph / line / bullet / Companion box
    const blocksOf = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,li,blockquote[data-ai-note]")).filter((b) => !b.parentElement?.closest("blockquote[data-ai-note]") && (b.textContent || "").trim());
    const fits = (b: HTMLElement) => kind === "heading" ? /^H\d$/.test(b.tagName) : kind === "bullet" ? b.tagName === "LI" : kind === "box" ? b.tagName === "BLOCKQUOTE" : kind ? /^(P|LI)$/.test(b.tagName) : true;
    const what = (b: HTMLElement) => b.tagName === "BLOCKQUOTE" ? "Companion box" : /^H\d$/.test(b.tagName) ? "heading" : b.tagName === "LI" ? "bullet point" : "paragraph";
    const remove = (b: HTMLElement) => { const list = b.tagName === "LI" ? b.parentElement : null; b.remove(); if (list && !list.querySelector("li")) list.remove(); if (ed.current && !ed.current.innerHTML.trim()) ed.current.innerHTML = "<p><br></p>"; };
    if (!t || /^(this|that|it|current|the current|last|first)$/.test(tl)) {
      const bs = blocksOf(ed.current!).filter(fits), c = caretRange.current?.startContainer; let b: HTMLElement | undefined;
      if (tl === "last") b = bs[bs.length - 1]; else if (tl === "first") b = bs[0];
      else { b = bs.filter((x) => c && x.contains(c)).pop(); if (!b && c && (kind === "heading" || kind === "box")) b = [...bs].reverse().find((x) => x.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); if (!b && (kind === "heading" || kind === "box") && bs.length === 1) b = bs[0]; }
      if (!b) { say(kind ? `Click in the ${kind === "box" ? "box" : kind} you want to delete, or name it (“delete the ${kind} about …”).` : "Click in the paragraph you want to delete, or select the text, then say it again.", "info"); return; }
      const txt = (b.textContent || "").trim(), w = what(b); remove(b); syncEditor(); markDirty(); bump(); bumpThumbs(); say(`Deleted the ${w} “${short(txt)}”.`, "ok", true); return;
    }
    const want = textKey(t), ww = want.split(" ").filter(Boolean);
    const score = (b: HTMLElement) => { const k = textKey(/^H\d$/.test(b.tagName) ? headingText(b) : b.textContent || ""); return k === want ? 3 : k.includes(want) ? 2 + Math.min(0.9, want.length / Math.max(1, k.length)) : ww.filter((x) => k.split(" ").includes(x)).length / Math.max(1, ww.length) >= 0.6 ? 1 : 0; };
    for (const si of [i, ...sheetsRef.current.map((_, k) => k).filter((k) => k !== i)]) {
      let txt = "", w = "";
      const changed = onSheet(si, (root) => { let best: HTMLElement | null = null, bs = 0; for (const b of blocksOf(root).filter(fits)) { const s = score(b); if (s > bs) { best = b; bs = s; } } if (!best) return false; txt = (best.textContent || "").trim(); w = what(best); remove(best); return true; });
      if (changed) { syncEditor(); markDirty(); bump(); bumpThumbs(); if (si !== i) goTo(si); say(`Deleted the ${w} “${short(txt)}”${si !== i ? ` on sheet ${si + 1}` : ""}.`, "ok", true); return; }
    }
    say(`I couldn't find ${kind ? `a ${kind === "box" ? "box" : kind} matching ` : ""}“${t}” in this notebook.`, "info");
  }
  const openStudy = async (mode: StudyMode, scope: "note" | "sheet" = "note") => { if (dirty.current) await saveNow(); setStudy({ mode, scope }); };
  const visualizeSheet = () => { const t = sheetText(); if (!t) { say("This sheet is empty. Write or dictate something first, then I can turn it into a visual.", "info"); return; } setViz({ text: t }); };
  // ---------- companion ----------
  async function ask(prompt: string, o: { voice?: boolean; into?: "new_sheet" | "notes" } = {}) {
    const n = noteRef.current; prompt = prompt.trim(); if (!prompt || chatBusy || !n) return "";
    setChatBusy(true); setChatErr(""); setStream(""); let speaker: ReturnType<typeof startSpeaker> | null = null, answer = "", added = false;
    try {
      if (dirty.current) await saveNow();
      let s = sid; if (!s) { s = (await api("/chat/sessions", { json: {} })).id; setSid(s); }
      setMsgs((m) => [...m, { role: "user", content: prompt }]); added = true; setCaption({ kind: "reply", text: "…" });
      if (voiceReplies) { speaker = startSpeaker(voice); blockRef.current = true; setAssistantSpeaking(true); speaker.done.catch((e: any) => { setChatErr(e.message); setCaption({ kind: "error", text: e.message }); }); }
      const r = await askStream(s!, prompt, n.id, (d) => { setStream((t) => { const nt = t + d; setCaption({ kind: "reply", text: speakable(nt) }); return nt; }); speaker?.push(d); }, { sheet_index: activeRef.current, selection: selText(), voice: !!o.voice });
      answer = r.content; setMsgs((m) => [...m, { role: "assistant", content: r.content, sources: r.sources }]); setStream(""); setCaption({ kind: "reply", text: speakable(r.content) });
      if (o.into === "new_sheet") addSheet(textToHtml(speakable(r.content).replace(/\s*[•\-]\s+/g, "\n")), false);
      if (o.into === "notes") addNoteBox(boxLabel(prompt), mdToHtml(r.content));
      speaker?.end(); await speaker?.done.catch(() => {});
    } catch (e: any) { stopSpeaking(); setStream(""); setChatErr(e.message); setCaption({ kind: "error", text: e.message }); if (added) setMsgs((m) => m.slice(0, -1)); }
    finally { setChatBusy(false); if (speaker) { setTimeout(() => { blockRef.current = false; setAssistantSpeaking(false); }, 500); } }
    return answer;
  }
  const noteChips = (text: string) => text.split(/(\[note:\d+\])/).map((p, i) => { const m = p.match(/\[note:(\d+)\]/); if (!m) return p; return +m[1] === noteRef.current?.id ? <span key={i} className="chip">this notebook</span> : <button key={i} className="chip mint" onClick={() => nav(`/n/${m[1]}`)}>from your notes</button>; });

  // ---------- voice ----------
  useEffect(() => { speechHooks.onPlay = () => setVoicePlaying(true); speechHooks.onFallback = (why) => setVoiceNote(`${why}, so I'm using your browser's own voice for now.`); return () => { speechHooks.onPlay = undefined; speechHooks.onFallback = undefined; }; }, []);
  useEffect(() => { const c = (note?.language || lang || "en-IN").split(",")[0]; speechHooks.lang = c === "indic-auto" ? "en-IN" : c; }, [note?.language, lang]);
  /** The Indian language this notebook is spoken in (first non-English one), for "read it in Telugu" etc. */
  const ownLang = () => (noteRef.current?.language || "").split(",").find((c: string) => c && c !== "en-IN" && c !== "indic-auto") || "";
  useEffect(() => { if (!assistantSpeaking) setVoicePlaying(false); }, [assistantSpeaking]);
  useEffect(() => { if (!voiceNote) return; const t = setTimeout(() => setVoiceNote(""), 20000); return () => clearTimeout(t); }, [voiceNote]);
  const ctx = () => ({ note_id: noteRef.current?.id, object_selected: !!selObj, title: noteRef.current?.title || "", sheet_index: activeRef.current + 1, sheet_count: sheetsRef.current.length, selection: selText(), sheet_tail: sheetText(), language: noteRef.current?.language || lang, headings: ed.current ? headingsOf(ed.current).map(headingText) : [], terms: ownTerms() });
  /** Acronyms, CamelCase names and capitalised terms used in this notebook (sent so dictation spells them the same way). */
  const ownTerms = () => {
    const txt = sheetsRef.current.map((x) => x.html.replace(/<[^>]+>/g, " ")).join(" "), c = new Map<string, number>();
    for (const m of txt.matchAll(/\b(?:[A-Z]{2,}[A-Za-z0-9-]*|[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-z]{3,})\b/g)) if (!TERM_STOP.has(m[0])) c.set(m[0], (c.get(m[0]) || 0) + 1);
    return [...c.entries()].filter(([w, n]) => n >= 2 || /^[A-Z]{2,}/.test(w)).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w);
  };
  const say = (text: string, kind: "ok" | "info" | "error" = "ok", undo = false) => setCaption({ kind, text, undo });
  const LABELS: Record<string, string> = { new_sheet: "adding a sheet", format: "the formatting", rename_note: "the rename", summarize: "adding the summary", compose: "what I wrote", edit_text: "the text change", organize: "organizing the notes", add_to_notes: "adding the note box", delete: "the delete" };
  async function dispatch(intent: any, heard: string) {
    if (intent.type === "command" && (intent.action === "undo" || intent.action === "redo")) return run(intent, heard);
    const before = snapNow(intent.type === "command" ? LABELS[intent.action] || String(intent.action || "that").replace(/_/g, " ") : intent.type === "question" ? "the question" : `writing “${short(intent.text || heard)}”`);
    try { await run(intent, heard); } finally { if (commitIfChanged(before)) setCaption((c) => (c && c.kind !== "error" ? { ...c, undo: true } : c)); }
  }
  async function run(intent: any, heard: string) {
    if (intent.type === "question") { await ask(intent.text || heard, { voice: true }); return; }
    if (intent.type !== "command") { const t = intent.text || heard; insertText(t); say(intent.uncertain ? `Added to sheet ${activeRef.current + 1} as text: “${t}”` : `Added to sheet ${activeRef.current + 1}: “${t}”`); return; }
    const a = intent.args || {}, i = activeRef.current;
    switch (intent.action) {
      case "new_sheet": { const n = addSheet(); say(`New sheet added (sheet ${n}).`); break; }
      case "go_to_sheet": { const n = sheetsRef.current.length, t = a.target; const to = t === "next" ? i + 1 : t === "previous" ? i - 1 : t === "first" ? 0 : t === "last" ? n - 1 : Number(t) - 1; if (!Number.isFinite(to) || to < 0 || to >= n) { say(`There's no sheet ${t}. This notebook has ${n}.`, "info"); break; } goTo(to); say(`Sheet ${to + 1} of ${n}.`); break; }
      case "toggle_sheet_panel": togglePanel(); say("Toggled the sheet panel."); break;
      case "format": {
        const r = selRange.current; if (!r) { say("Select some text first, then tell me how to format it.", "info"); break; }
        if (a.style) { const m: any = { bold: ["bold"], italic: ["italic"], underline: ["underline"], heading: ["formatBlock", "h2"], paragraph: ["formatBlock", "p"], bullets: ["insertUnorderedList"], numbered: ["insertOrderedList"] }[a.style]; if (m) withSel(r, () => document.execCommand(m[0], false, m[1])); }
        if (a.color) withSel(r, () => applyColor("foreColor", String(a.color)));
        if (a.highlight) withSel(r, () => applyColor("hiliteColor", String(a.highlight)));
        if (a.font_size) { const now = currentFontSize(r), px = a.font_size === "bigger" ? now + 4 : a.font_size === "smaller" ? Math.max(8, now - 4) : Number(a.font_size); if (px >= 8 && px <= 96) withSel(r, () => applyFontSize(ed.current!, px)); }
        say("Formatting applied."); break;
      }
      case "visualize": {
        const topic = a.scope === "topic" && a.topic ? String(a.topic) : "", text = topic || (a.scope === "sheet" ? sheetText() : selText() || sheetText());
        if (!text) { say("Select some text or write something first, then ask for a visual.", "info"); break; }
        setViz({ text, topic: !!topic, hint: a.kind || "" }); say(a.kind === "labelled" ? "Drawing a labelled diagram…" : "Building a visual…"); break;
      }
      case "rename_note": if (a.title) { setMeta({ title: String(a.title).slice(0, 120) }); say(`Renamed to “${a.title}”.`); } break;
      case "pin_note": { const p = a.pinned === false ? 0 : 1; await api("/notes/" + noteRef.current.id, { method: "PUT", json: { pinned: p } }); say(p ? "Pinned this notebook." : "Unpinned."); break; }
      case "new_note": { await saveNow(); const x = await api("/notes", { json: { title: a.title || "Untitled notebook", language: noteRef.current.language } }); nav(`/n/${x.id}?new=1`); break; }
      case "open_note": {
        const q = String(a.title || "").toLowerCase(), all: any[] = await api("/notes"), words = q.split(/\s+/).filter(Boolean);
        const best = all.map((n) => ({ n, s: (n.title.toLowerCase().includes(q) ? 10 : 0) + words.filter((w) => n.title.toLowerCase().includes(w)).length })).sort((x, y) => y.s - x.s)[0];
        if (best && best.s > 0) { nav(`/n/${best.n.id}`); } else say(`I couldn't find a notebook called “${a.title}”.`, "info"); break;
      }
      case "go_home": nav("/"); break;
      case "read_aloud": {
        const want = a.language && a.language !== "en-IN" ? String(a.language) : "";
        const s = selText(); if ((a.scope === "selection" || !a.scope) && s) { await readText(s, want); break; }
        const text = a.scope === "note" ? sheetsRef.current.map((s, k2) => (k2 === i ? ed.current?.innerText || "" : s.html.replace(/<[^>]+>/g, " "))).join(". ") : sheetText();
        if (a.scope === "selection") say("No text is selected, so I'll read the whole sheet.", "info");
        if (!text.trim()) { say("There's nothing to read yet.", "info"); break; }
        await readText(`${noteRef.current.title}. ${text}`, want); break;
      }
      case "edit_text": editText(a); break;
      case "organize": await organize(a.scope === "sheet" ? "sheet" : "note"); break;
      case "add_to_notes": addReplyToNotes(); break;
      case "stop_speaking": stopSpeaking(); blockRef.current = false; setAssistantSpeaking(false); say("Stopped."); break;
      case "stop_listening": loopRef.current?.stop(); say("Voice mode off.", "info"); break;
      case "undo": doUndo(); break;
      case "redo": doRedo(); break;
      case "delete": await doDelete(a); break;
      case "summarize": await ask(a.scope === "sheet" ? `Summarize sheet ${i + 1} in a few short bullet points.` : "Summarize this whole notebook in a few short bullet points.", { voice: true, into: a.into === "new_sheet" ? "new_sheet" : a.into === "notes" ? "notes" : undefined }); break;
      case "study": { const m: StudyMode = ["quiz", "flashcards", "gaps"].includes(a.mode) ? a.mode : "quiz"; await openStudy(m, a.scope === "sheet" ? "sheet" : "note"); say(m === "quiz" ? "Getting a quiz ready…" : m === "flashcards" ? "Making flashcards…" : "Checking what your notes are missing…", "info"); break; }
      case "compose": await runCompose(String(a.instruction || heard)); break;
      case "export": await doExport(a.format === "word" ? "word" : a.format === "markdown" ? "markdown" : "pdf"); break;
      case "import_notes": say("Use File → Import to pick a photo or PDF. The browser only opens the file picker from a click.", "info"); break;
      case "lecture": loopRef.current?.stop(); setCompanionOpen(false); setLectureOpen(true); say("Lecture mode: press Start when the class begins.", "info"); break;
      case "open_materials": setMatOpen(true); say("Add your syllabus, slides or a textbook chapter here: the AI uses it for this notebook.", "info"); break;
      case "open_companion": setCompanionOpen(true); say("Companion opened."); break;
      case "close_companion": setCompanionOpen(false); say("Companion closed."); break;
      case "unsupported": say(a.message || "That isn't available by voice.", "info"); break;
      default: insertText(heard); say(`Added to sheet ${i + 1}: “${heard}”`);
    }
  }
  async function handleUtterance(wav: Blob) {
    setProcessing(true);
    try {
      const fd = new FormData(); fd.append("audio", wav, "voice.wav"); fd.append("language", noteRef.current?.language || lang);
      fd.append("note_id", String(noteRef.current?.id || "")); fd.append("terms", JSON.stringify(ownTerms())); fd.append("previous_text", sheetText().slice(-600)); fd.append("source", "dictation");
      let text = ""; try { text = ((await api("/audio/transcribe", { method: "POST", body: fd })).transcript || "").trim(); } catch (e: any) { if (/too short|no speech/i.test(e.message)) return; throw e; }
      if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return;
      await processText(text);
    } catch (e: any) { setCaption({ kind: "error", text: e.message }); } finally { setProcessing(false); }
  }
  async function processText(text: string) {
    setProcessing(true);
    try {
      setCaption({ kind: "heard", text });
      if (orgPreview) {     // answering the organize preview by voice
        const tt = text.trim();
        if (/^(yes|yeah|yep|apply|ok(ay)?|sure|do it|go ahead|looks good|keep (it|this|the new one))\b/i.test(tt)) { applyOrganize(); return; }
        if (/^(no|nope|cancel|don'?t|discard|keep (the )?old|undo)\b/i.test(tt)) { cancelOrganize(); return; }
      }
      if (confirmDel) {
        const c = confirmDel, tt = text.trim(); setConfirmDel(null);
        if (Date.now() - c.at < 60000 && /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm|do it|go ahead|delete( it)?)\b/i.test(tt)) { await c.run(); return; }
        if (/^(no|nope|cancel|stop|don'?t|keep( it)?)\b/i.test(tt)) { say("Okay, I kept the notebook.", "info"); return; }
      }
      const intent = await api("/voice/interpret", { json: { text, context: ctx() } });
      if (intent.ai_error) setErr("The AI couldn't classify that, so I used simple rules: " + intent.ai_error);
      await dispatch(intent, text);
    } catch (e: any) { setCaption({ kind: "error", text: e.message }); } finally { setProcessing(false); }
  }
  latest.current = { handleUtterance };
  async function toggleMic() {
    if (assistantSpeaking) { stopSpeaking(); blockRef.current = false; setAssistantSpeaking(false); return; }
    if (voiceState !== "off") { loopRef.current?.stop(); return; }
    if (status && !status.gnani) { say("Voice isn't set up: add GNANI_API_KEY to backend/.env and restart Flask.", "error"); return; }
    const loop = createVoiceLoop({ onState: setVoiceState, onUtterance: (w) => latest.current.handleUtterance(w), onError: (m) => setCaption({ kind: "error", text: m }), onLevel: (r) => micRef.current?.style.setProperty("--lvl", String(Math.min(1, r * 12))), isBlocked: () => blockRef.current });
    loopRef.current = loop; try { await loop.start(); say("Listening. Just talk: I'll write what you say, or act if it's a command.", "info"); } catch (e: any) { say(e.message, "error"); }
  }
  const togglePanel = () => setPanelOpen((v) => { localStorage.setItem("nb-panel", v ? "0" : "1"); return !v; });
  // keyboard: delete / nudge selected image, Ctrl+Enter = new sheet
  latest.current.keys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement, typing = !!t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); addSheet(); return; }
    if (!typing && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if ((k === "c" || k === "x") && selObj) { e.preventDefault(); copyObj(selObj, k === "x"); return; }
      if (k === "v" && objClip.current) { e.preventDefault(); pasteObj(); return; }
      if (k === "d" && selObj) { e.preventDefault(); copyObj(selObj); pasteObj(); return; }
    }
    if (!selObj || typing) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteObj(selObj); } else if (e.key === "Escape") setSelObj(null);
    else if (e.key.startsWith("Arrow")) { e.preventDefault(); const o = cur?.objects.find((x) => x.id === selObj); if (!o) return; const d = e.shiftKey ? 10 : 2; patchObj(selObj, { x: o.x + (e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0), y: o.y + (e.key === "ArrowDown" ? d : e.key === "ArrowUp" ? -d : 0) }); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => latest.current.keys(e); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  if (err && !note) return <main className="home"><div className="err">{err}</div><button className="btn" onClick={() => nav("/")}>← Back to notebooks</button></main>;
  if (!note || !cur) return <main className="home"><p className="muted">Opening notebook…</p></main>;
  const TOUR: TourStep[] = [
    { title: "Talk, and it writes", text: "Tap the big mic once and just talk about what you're studying. Everything you say is written into the sheet.", say: "Plants make their own food from sunlight, water and carbon dioxide." },
    { title: "Ask it to write for you", text: "Tell it what to put on the page: headings, a summary, bullet points. It knows it's an instruction, not dictation.", say: "Put a heading Photosynthesis with a small side heading Biology Unit 1, then add a short summary" },
    { title: "Diagrams in one sentence", text: "Ask for a diagram of any process, cycle or system and it's drawn onto the sheet.", say: "Add a diagram of photosynthesis" },
    { title: "Change anything by voice", text: "Rename headings, replace words, delete lines, organize the whole notebook: no mouse needed.", say: "Replace the heading Photosynthesis with How Plants Make Food" },
    { title: "Didn't mean that? Undo", text: "Every change can be undone, by saying “undo” or with ↶ Undo next to the mic.", say: "Undo" },
    { title: "Listen to your notes", text: "Revise with your ears: select any text and press 🔊 Read, or ask it to read the sheet.", say: "Read this sheet aloud" },
    { title: "Test yourself", text: "Quizzes, flashcards and “what did I miss?” are made from your own notes.", say: "Quiz me" },
    { title: "Make it yours", text: "Add your syllabus or slides so the AI knows your course and shows how much of it your notes cover. In class, record the whole lecture and get notes at the end.",
      actions: [["📚 Add course material", () => setMatOpen(true)], ["🎙 Record a lecture", () => { setLectureOpen(true); setCompanionOpen(false); }]] },
  ];
  const n = sheets.length, layers = Math.min(2, n - 1), lvl = voiceState === "hearing" ? "hearing" : voiceState === "off" ? "off" : "on";
  const micLabel = assistantSpeaking ? (voicePlaying ? "Speaking · tap to stop" : "Getting the voice ready… · tap to stop") : processing ? "Thinking…" : voiceState === "starting" ? "Starting mic…" : voiceState === "hearing" ? "Hearing you…" : voiceState === "listening" ? "Listening · tap to stop" : "Tap to talk";
  return <div className="nb">
    <div className="nb-bar">
      <button className="btn sm ghost" onClick={() => { if (lecState === "recording" || lecState === "paused") { if (!confirm("A lecture is being recorded. Leave and stop recording? (The transcript so far is kept.)")) return; } nav("/"); }} aria-label="Back to all notebooks" title="All notebooks">←<span className="lbl"> Notebooks</span></button>
      <button className={"btn sm " + (panelOpen ? "lav" : "ghost")} onClick={togglePanel} aria-pressed={panelOpen} aria-label="Sheets panel" title="Show or hide the sheets">▤<span className="lbl"> Sheets</span></button>
      <input ref={titleRef} className="nb-title" value={note.title} onChange={(e) => setMeta({ title: e.target.value })} aria-label="Notebook title" />
      <span className="muted nb-saved" role="status">{saved}</span>
      <span className="nb-tools">
        <button className={"btn sm " + (companionOpen && !lectureOpen ? "blue" : "peach")} onClick={() => { if (lectureOpen && (lecState === "recording" || lecState === "paused")) { say("Lecture mode is recording. Stop it first, then open the Companion.", "info"); return; } setLectureOpen(false); setCompanionOpen((v) => !(v && !lectureOpen)); }} aria-pressed={companionOpen && !lectureOpen} aria-label="Companion" title="Ask about your notebook">✦<span className="lbl"> Companion</span></button>
        <button className={"btn sm " + (lectureOpen ? "coral" : "ghost")} onClick={() => { if (lectureOpen) { if (lecState === "recording" || lecState === "paused") { say("Stop the recording in the lecture panel first.", "info"); return; } setLectureOpen(false); } else { setLectureOpen(true); setCompanionOpen(false); } }} aria-pressed={lectureOpen} aria-label="Lecture mode" title="Record a whole class and turn it into notes">🎙<span className="lbl"> {lecState === "recording" ? "Recording…" : lecState === "paused" ? "Paused" : "Lecture"}</span>{lecState === "recording" && <i className="rec-dot" aria-hidden />}</button>
        <button className="btn sm mint" onClick={() => void openStudy("quiz")} aria-label="Study" title="Quiz, flashcards, what did I miss?">🎓<span className="lbl"> Study</span></button>
        <button className={"btn sm " + (materials.length ? "lav" : "ghost")} onClick={() => setMatOpen(true)} aria-label={`Course material (${materials.length})${coverage?.total ? `, ${coverage.percent}% covered` : ""}`}
          title={materials.length ? `Course material: ${materials.map((m) => m.name).join(", ")}${coverage?.total ? ` · notes cover ${coverage.percent}% of its topics` : ""}` : "Add the syllabus, slides or a chapter so the AI knows what this notebook is about"}>📚<span className="lbl"> Material</span>{coverage?.total ? <span className="badge">{coverage.percent}%</span> : materials.length ? <span className="badge">{materials.length}</span> : null}</button>
        <FileMenu busy={fileBusy} onExport={doExport} onImport={doImport} onImportDoc={(f) => void doImportDoc(f)} onBackup={() => void doBackup()} />
        <VoiceSettings><label>Notebook language (what you speak)<select value={note.language} onChange={(e) => setMeta({ language: e.target.value })}>{languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></label></VoiceSettings>
      </span>
    </div>
    {err && <div className="err" onClick={() => setErr("")}>{err}</div>}
    <div className="nb-body">
      {panelOpen && <SheetPanel sheets={sheets} active={active} ver={thumbVer} onSelect={goTo} onAdd={() => addSheet()} onDuplicate={duplicateSheet} onDelete={deleteSheet} onMove={moveSheet} onClose={togglePanel} />}
      <div className="stage" ref={stage}>
        <div className="page-wrap" style={{ width: PAGE_W * k + 16, height: PAGE_H * k + 16 }}>
          {layers >= 2 && <i className="layer l2" style={{ width: PAGE_W * k, height: PAGE_H * k }} />}{layers >= 1 && <i className="layer l1" style={{ width: PAGE_W * k, height: PAGE_H * k }} />}
          <div className="page" ref={pageRef} style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${k})` }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={(e) => { const all = Array.from(e.dataTransfer.files), pdfs = all.filter((x) => x.type === "application/pdf"), f = all.filter((x) => x.type.startsWith("image/")); if (pdfs.length) { e.preventDefault(); void doImport(pdfs); } else if (f.length) { e.preventDefault(); void addImages(f, pagePoint(e)); } }}>
            <div ref={ed} className="page-editor" contentEditable suppressContentEditableWarning spellCheck aria-label={`Sheet ${active + 1} of ${n}`} aria-multiline role="textbox"
              onInput={() => { lastText.current = Date.now(); onInput(); }} onPaste={pasteHandler} onMouseDown={() => setSelObj(null)} />
            <ObjectLayer objects={cur.objects} selected={selObj} k={k} onSelect={setSelObj} onPatch={patchObj} onDelete={deleteObj} onCopy={(id) => copyObj(id)} onRestyle={(o) => setViz({ text: o.alt, replace: o.id, initial: o.meta })} />
          </div>
        </div>
        <div className="pager">{hasClip && <button className="btn sm" onClick={pasteObj} title="Paste the copied picture or visual onto this sheet (Ctrl+V)">📋 Paste visual</button>}<button className="btn sm ghost" disabled={active === 0} onClick={() => goTo(active - 1)} aria-label="Previous sheet">‹</button><span>Sheet {active + 1} of {n}</span><button className="btn sm ghost" disabled={active >= n - 1} onClick={() => goTo(active + 1)} aria-label="Next sheet">›</button><button className="btn sm mint" onClick={() => addSheet()}>+ Sheet</button><button className="btn sm lav" onClick={visualizeSheet} title="Turn everything on this sheet into a diagram">✦ Visualize sheet</button></div>
        <div className="dock">
          {hintsOpen && <div className="hints" role="note"><b>Things you can say</b><ul>{HINTS.map((h) => <li key={h}>{h}</li>)}</ul></div>}
          {confirmDel && <div className="caption error" role="alertdialog">{confirmDel.text} <button className="btn sm coral" onClick={() => { const c = confirmDel; setConfirmDel(null); c.run().catch((e: any) => say(e.message, "error")); }}>Delete notebook</button> <button className="btn sm ghost" onClick={() => { setConfirmDel(null); say("Okay, I kept the notebook.", "info"); }}>Cancel</button></div>}
          {caption && <div className={"caption " + caption.kind} role="status" aria-live="polite">{caption.kind === "heard" && <span className="muted">You said: </span>}<span className="ctext">{caption.text}</span>
            {(caption.undo || (caption.kind === "reply" && caption.text.length > 200 && !lectureOpen)) && <span className="cacts">{caption.undo && <button className="btn sm ghost" onClick={doUndo}>↶ Undo</button>}
              {caption.kind === "reply" && caption.text.length > 200 && !lectureOpen && <button className="btn sm ghost" onClick={() => setCompanionOpen(true)}>Read it all in the Companion ›</button>}</span>}</div>}
          {typeOpen && <form className="dock-type" onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t && !processing) { setTyped(""); void processText(t); } }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type what you'd say, e.g. “add a summary and a diagram of RNNs”" aria-label="Type a command or note" autoFocus /><button className="btn sm blue" disabled={processing || !typed.trim()}>Send</button></form>}
          <div className="dock-row">
            <button className="dock-mini" onClick={doUndo} title="Undo the last change (or say “undo”)">↶<small>Undo</small></button>
            <button className={"dock-mini" + (voiceReplies ? " on" : "")} onClick={() => { setVoiceReplies((v) => { localStorage.setItem("voiceReplies", v ? "0" : "1"); return !v; }); stopSpeaking(); }} aria-pressed={voiceReplies} title="Speak answers aloud">{voiceReplies ? "🔊" : "🔇"}<small>Replies</small></button>
            <button ref={micRef} className={`mic ${lvl}${processing ? " busy" : ""}${assistantSpeaking ? " talking" : ""}`} onClick={toggleMic} aria-pressed={voiceState !== "off"} aria-label={micLabel}>
              <span className="mic-ring" aria-hidden /><svg viewBox="0 0 24 24" width="40" height="40" aria-hidden><rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
            </button>
            <button className={"dock-mini" + (typeOpen ? " on" : "")} onClick={() => setTypeOpen((v) => !v)} aria-pressed={typeOpen} title="Type a command or note instead of speaking">⌨<small>Type</small></button>
            <button className={"dock-mini" + (hintsOpen ? " on" : "")} onClick={() => setHintsOpen((v) => !v)} aria-pressed={hintsOpen} title="What can I say?">?<small>Help</small></button>
            {redoStack.current.length > 0 && <button className="dock-mini" onClick={doRedo} title="Redo what Undo took back (or say “redo”)">↷<small>Redo</small></button>}
          </div>
          <div className="mic-label">{micLabel}</div>{voiceNote && <div className="mic-label" role="status" style={{ fontSize: 13, opacity: .85 }}>🔈 {voiceNote}</div>}
        </div>
      </div>
      {lectureOpen && <LecturePanel onState={setLecState} noteId={note.id} language={note.language || lang} languageName={languages.find((l) => l.code === (note.language || lang))?.name || note.language} terms={ownTerms()} hasMaterial={materials.length > 0} onClose={() => setLectureOpen(false)}
        onBeforeStart={() => { loopRef.current?.stop(); stopSpeaking(); blockRef.current = false; setAssistantSpeaking(false); }} onNotes={insertLecture} />}
      {companionOpen && !lectureOpen && <aside className="companion-drawer" aria-label="Companion">
        <div className="row"><b className="grow">✦ Companion</b><button className="btn sm ghost" onClick={() => setCompanionOpen(false)}>Close</button></div>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>I can see every sheet in this notebook, your selection, and the images and visuals on them{materials.length ? `, plus your course material (${materials.map((m) => m.name).join(", ")})` : ""}. Talk with the big mic, or type here.</p>
        {!materials.length && <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setMatOpen(true)}>📚 Add course material so I know what this notebook is about</button>}
        <div className="chat">
          {!msgs.length && !stream && <div>{["Summarize this notebook", "Quiz me on this", "What am I missing?", "Explain sheet " + (active + 1) + " simply"].map((q) => <button key={q} className="chip peach" disabled={chatBusy} onClick={() => void ask(q)}>{q}</button>)}</div>}
          {msgs.map((m, i) => <div key={i} className={"bubble " + (m.role === "user" ? "me" : "ai")}>{m.role === "user" ? m.content : noteChips(m.content)}
            {m.role !== "user" && <div className="row" style={{ marginTop: 4 }}><button className="btn sm ghost" onClick={() => void readText(speakable(m.content))} aria-pressed={assistantSpeaking}>{assistantSpeaking ? "■ Stop" : "▶ Listen"}</button>
              {ownLang() && !assistantSpeaking && <button className="btn sm ghost" onClick={() => void readText(speakable(m.content), ownLang())} title={`Hear this explained in ${LANG_NAME[ownLang()]}`}>▶ {LANG_NAME[ownLang()]}</button>}
              <button className="btn sm mint" onClick={() => addReplyToNotes(i)} title="Put this answer into the current sheet as a small boxed note">📌 Add to notes</button>
              <button className="btn sm ghost" onClick={() => addSheet(textToHtml(speakable(m.content)), false)}>Add to a new sheet</button></div>}</div>)}
          {stream && <div className="bubble ai">{noteChips(stream)}</div>}{chatBusy && !stream && <div className="bubble ai muted">Thinking about your notebook…</div>}<div ref={chatEnd} />
        </div>
        {chatErr && <div className="err" onClick={() => setChatErr("")}>{chatErr}</div>}
        <div className="row"><textarea rows={2} className="grow" value={chatText} placeholder="Ask about this notebook…" onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = chatText; setChatText(""); void ask(t); } }} />
          <button className="btn blue" disabled={chatBusy || !chatText.trim()} onClick={() => { const t = chatText; setChatText(""); void ask(t); }}>Send</button></div>
      </aside>}
    </div>
    <SelectionBar ed={ed} onChange={onInput} onVisualize={(t) => setViz({ text: t })} onAsk={(t) => { setCompanionOpen(true); void ask(`Explain this part of my notes simply: “${t.slice(0, 600)}”`); }} onRead={(t) => void readText(t)} reading={assistantSpeaking} readIn={ownLang() ? { label: LANG_NAME[ownLang()], go: (t: string) => void readText(t, ownLang()) } : undefined} />
    {study && <StudyDialog noteId={note.id} sheetIndex={active} sheetCount={n} initialMode={study.mode} initialScope={study.scope} voice={voice} onAddSheet={(h) => addSheet(h, false)} onAddNote={addNoteBox} onGoToSheet={goTo} onClose={() => setStudy(null)} />}
    {matOpen && <MaterialsDialog noteId={note.id} language={note.language || lang} terms={ownTerms()} items={materials} onClose={() => setMatOpen(false)} coverage={coverage} onCoverage={setCoverage} onGoToSheet={goTo}
      onAddTopic={(topic, hint) => { const ins = `Add a short section on "${topic}" with a subheading and 3 to 5 bullet points from the course material${hint ? ` (${hint})` : ""}.`; void dispatch({ type: "command", action: "compose", args: { instruction: ins } }, ins); }}
      onChange={(m) => {
      const added = m.filter((x) => !materials.some((y) => y.id === x.id)); setMaterials(m);
      if (added.length) { const topics = added.flatMap((x) => x.topics).slice(0, 6); say(topics.length ? `Got it. This notebook covers: ${topics.join(", ")}.` : `Added ${added.map((x) => x.name).join(", ")}.`, "ok"); }
    }} />}
    {orgPreview && <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && cancelOrganize()}>
      <div className="modal org" role="dialog" aria-modal="true" aria-label="Organized notes: preview">
        <div className="row viz-head"><h2 className="grow">✦ Organized: check before applying</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>{orgPreview.say} Pictures stay where they are. Say “apply” or “cancel”, or use the buttons.</p>
        <div className="org-list">{orgPreview.items.map((it) => <div key={it.id} className="org-item"><b>Sheet {it.i + 1}</b>
          <div className="org-cols"><div><small className="muted">Before</small><div className="org-page" dangerouslySetInnerHTML={{ __html: sanitize(it.before) }} /></div>
            <div><small className="muted">After</small><div className="org-page after" dangerouslySetInnerHTML={{ __html: sanitize(it.after) }} /></div></div></div>)}</div>
        <div className="row viz-foot"><button className="btn blue" onClick={applyOrganize} autoFocus>Apply</button><button className="btn ghost" onClick={cancelOrganize}>Cancel, keep my notes</button></div>
      </div></div>}
    {tour && <TourCard busy={processing} steps={TOUR} onTry={(t) => void processText(t)} onEnd={(done) => { setTour(false); try { localStorage.setItem("tourDone", "1"); } catch {} nav(`/n/${note.id}`, { replace: true }); if (done) say("You're all set. Tap the mic any time, or press ? Help for more things to say.", "ok"); }} />}
    {viz && <VisualizeDialog key={viz.replace || viz.text} text={viz.text} topic={viz.topic} hint={viz.hint} initial={viz.initial} onInsert={insertViz} onClose={() => setViz(null)} />}
  </div>;
}
