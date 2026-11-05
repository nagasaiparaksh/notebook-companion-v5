/** Turn photos / scans / PDFs of notes into sheet HTML (the server reads them with Gemini vision). */
import { api } from "../api";
import { escHtml } from "./editing";

/** Downscale a photo so uploads are fast and cheap, while handwriting stays readable. */
export async function shrinkImage(file: File, max = 2000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error(`“${file.name}” isn't an image this browser can open (HEIC photos need converting to JPG first).`)); img.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}
export type ImportResult = { sheets: string[]; problems: string[] };
export async function importFiles(files: File[], progress: (msg: string) => void): Promise<ImportResult> {
  const sheets: string[] = [], problems: string[] = [];
  const readImage = async (image: string, label: string) => { progress(`Reading ${label}…`); try { sheets.push((await api("/import/page", { json: { image } })).html); } catch (e: any) { problems.push(`${label}: ${e.message}`); } };
  for (const f of files) {
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      progress(`Opening ${f.name}…`); const fd = new FormData(); fd.append("file", f);
      let r: any; try { r = await api("/import/pdf", { method: "POST", body: fd }); } catch (e: any) { problems.push(`${f.name}: ${e.message}`); continue; }
      for (const p of r.pages) { const label = `${f.name} (page ${p.n} of ${r.pages.length})`; if (p.kind === "text") sheets.push(p.html); else await readImage(p.image, label); }
      if (r.truncated) problems.push(`${f.name}: only the first ${r.pages.length} of ${r.total} pages were imported.`);
    } else if (f.type.startsWith("image/")) { try { await readImage(await shrinkImage(f), f.name); } catch (e: any) { problems.push(e.message); } }
    else problems.push(`${f.name}: only photos (JPG, PNG, WebP) and PDFs can be imported.`);
  }
  return { sheets, problems };
}
