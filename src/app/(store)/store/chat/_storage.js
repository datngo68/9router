// LocalStorage-backed conversation store for the store chat playground.
// Shape:
//   { activeId: string|null, items: { [id]: Conversation } }
// Conversation = {
//   id, title, model, mode: "llm"|"image", updatedAt,
//   messages: [{
//     role,
//     content,                          // string or OpenAI-style content array
//     attachments?: [{ id, kind, name, mime, size, dataUrl?, text? }],
//     images?:      [{ b64?, url?, mime }],
//   }]
// }

const KEY = "9r:chat:conversations";

// Stay below typical localStorage quota (5 MB on most browsers). Once the
// serialized state crosses this, we strip heavy fields (image dataUrls / b64)
// from older conversations before writing.
const SOFT_LIMIT_BYTES = 4 * 1024 * 1024;

function emptyState() {
  return { activeId: null, items: {} };
}

function safeParse(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.items && typeof obj.items === "object") {
      return { activeId: obj.activeId ?? null, items: obj.items };
    }
  } catch {}
  return emptyState();
}

export function loadAll() {
  if (typeof window === "undefined") return emptyState();
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return emptyState();
  return safeParse(raw);
}

// Strip heavy binary fields from older conversations until the serialized
// payload is under SOFT_LIMIT_BYTES. Returns { state, pruned } so the caller
// can surface a toast.
export function pruneOversize(state) {
  let serialized = JSON.stringify(state);
  if (serialized.length <= SOFT_LIMIT_BYTES) {
    return { state, pruned: false };
  }
  // Sort conversations oldest first; we trim them first, keeping the
  // currently active one untouched as long as possible.
  const ids = Object.values(state.items)
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .map((c) => c.id)
    .filter((id) => id !== state.activeId);
  ids.push(state.activeId); // active last

  const items = { ...state.items };
  for (const id of ids) {
    if (!id || !items[id]) continue;
    const conv = items[id];
    const messages = conv.messages.map((m) => stripHeavy(m));
    items[id] = { ...conv, messages };
    serialized = JSON.stringify({ ...state, items });
    if (serialized.length <= SOFT_LIMIT_BYTES) {
      return { state: { ...state, items }, pruned: true };
    }
  }
  return { state: { ...state, items }, pruned: true };
}

function stripHeavy(message) {
  let next = message;
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    const attachments = message.attachments.map((a) => {
      if (a.kind === "image" && a.dataUrl) {
        const { dataUrl, ...rest } = a;
        return { ...rest, stripped: true };
      }
      if (a.kind === "text" && a.text && a.text.length > 2000) {
        return { ...a, text: `${a.text.slice(0, 2000)}\n…[truncated]` };
      }
      return a;
    });
    next = { ...next, attachments };
  }
  if (Array.isArray(message.images) && message.images.length > 0) {
    const images = message.images.map((img) => {
      if (img.b64) {
        const { b64, ...rest } = img;
        return { ...rest, stripped: true };
      }
      return img;
    });
    next = { ...next, images };
  }
  return next;
}

export function saveAll(state) {
  if (typeof window === "undefined") return { ok: true, pruned: false };
  try {
    const payload = JSON.stringify(state);
    if (payload.length <= SOFT_LIMIT_BYTES) {
      window.localStorage.setItem(KEY, payload);
      return { ok: true, pruned: false };
    }
    const { state: pruned } = pruneOversize(state);
    window.localStorage.setItem(KEY, JSON.stringify(pruned));
    return { ok: true, pruned: true };
  } catch {
    // Quota exceeded — try once more with prune.
    try {
      const { state: pruned } = pruneOversize(state);
      window.localStorage.setItem(KEY, JSON.stringify(pruned));
      return { ok: true, pruned: true };
    } catch {
      return { ok: false, pruned: true };
    }
  }
}

export function listConversations(state) {
  return Object.values(state.items).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function createConversation(model, mode = "llm") {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: mode === "image" ? "Tạo ảnh mới" : "Cuộc trò chuyện mới",
    model: model || "",
    mode,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export function upsertConversation(state, conv) {
  const next = {
    ...state,
    items: {
      ...state.items,
      [conv.id]: { ...conv, mode: conv.mode || "llm", updatedAt: new Date().toISOString() },
    },
  };
  return next;
}

export function removeConversation(state, id) {
  if (!state.items[id]) return state;
  const items = { ...state.items };
  delete items[id];
  const activeId = state.activeId === id ? null : state.activeId;
  return { ...state, activeId, items };
}

export function setActive(state, id) {
  return { ...state, activeId: id };
}

export function deriveTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Cuộc trò chuyện mới";
  const raw = typeof first.content === "string"
    ? first.content
    : Array.isArray(first.content)
      ? first.content.find((c) => c.type === "text")?.text || ""
      : "";
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "Cuộc trò chuyện mới";
}
