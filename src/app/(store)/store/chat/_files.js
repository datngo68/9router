// File-reading helpers for the store chat playground.
//
// Browser-only. Each helper takes a `File` and returns a normalized attachment
// shape used by the chat page:
//   { id, kind, name, mime, size, dataUrl?, text? }
//
// PDF text extraction uses pdfjs-dist loaded from a CDN at runtime
// (`webpackIgnore` keeps it out of the bundle). Trade-off: requires network
// the first time; we keep the page zero-deps for now.

const PDFJS_CDN = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.mjs";
const PDFJS_WORKER_CDN = "https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

const TEXT_LIKE_EXT = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "log",
  "yaml", "yml", "ini", "conf", "env",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs",
  "java", "c", "cpp", "h", "hpp", "cs", "php", "sh",
  "html", "css", "xml", "sql",
]);

const MAX_TEXT_CHARS = 30000; // per-file truncation budget for prompts

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getExt(name) {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function classifyFile(file) {
  const mime = file.type || "";
  const ext = getExt(file.name);
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  if (TEXT_LIKE_EXT.has(ext)) return "text";
  if (mime === "application/json" || mime === "application/xml") return "text";
  return "unknown";
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Read failed"));
    reader.readAsText(file);
  });
}

function truncateText(s) {
  if (s.length <= MAX_TEXT_CHARS) return s;
  return `${s.slice(0, MAX_TEXT_CHARS)}\n\n…[truncated, file too large]`;
}

export async function readImageFile(file) {
  const dataUrl = await readAsDataURL(file);
  return {
    id: makeId(),
    kind: "image",
    name: file.name,
    mime: file.type || "image/*",
    size: file.size,
    dataUrl,
  };
}

export async function readTextFile(file) {
  const raw = await readAsText(file);
  return {
    id: makeId(),
    kind: "text",
    name: file.name,
    mime: file.type || "text/plain",
    size: file.size,
    text: truncateText(raw),
  };
}

let pdfjsModule = null;
async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;
  // webpackIgnore keeps this dynamic import as a runtime URL load.
  const mod = await import(/* webpackIgnore: true */ PDFJS_CDN);
  if (mod?.GlobalWorkerOptions) {
    mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  }
  pdfjsModule = mod;
  return mod;
}

export async function readPdfFile(file) {
  const buf = await file.arrayBuffer();
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const pages = [];
  const total = pdf.numPages || 0;
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = Array.isArray(content?.items) ? content.items : [];
    const text = items.map((it) => (typeof it?.str === "string" ? it.str : "")).join(" ");
    pages.push(`--- page ${i} ---\n${text}`);
    if (pages.join("\n").length > MAX_TEXT_CHARS) break;
  }
  return {
    id: makeId(),
    kind: "text",
    name: file.name,
    mime: "application/pdf",
    size: file.size,
    text: truncateText(pages.join("\n\n")),
  };
}

// Dispatch to the correct reader. Returns null when the file kind is
// unsupported so the caller can show a single error.
export async function readAnyFile(file) {
  const kind = classifyFile(file);
  if (kind === "image") return await readImageFile(file);
  if (kind === "text") return await readTextFile(file);
  if (kind === "pdf") return await readPdfFile(file);
  return null;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
