// LocalStorage-backed conversation store for the store chat playground.
// Shape:
//   { activeId: string|null, items: { [id]: Conversation } }
// Conversation = { id, title, model, updatedAt, messages: [{role, content}] }

const KEY = "9r:chat:conversations";

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

export function saveAll(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ignore quota errors — best effort persistence.
  }
}

export function listConversations(state) {
  return Object.values(state.items).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function createConversation(model) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: "Cuộc trò chuyện mới",
    model: model || "",
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export function upsertConversation(state, conv) {
  const next = {
    ...state,
    items: { ...state.items, [conv.id]: { ...conv, updatedAt: new Date().toISOString() } },
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
  const text = String(first.content || "").trim().replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "Cuộc trò chuyện mới";
}
