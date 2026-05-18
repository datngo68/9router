"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import {
  loadAll,
  saveAll,
  listConversations,
  createConversation,
  upsertConversation,
  removeConversation,
  setActive,
  deriveTitle,
} from "./_storage";

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return "";
  // marked.parse returns trusted-but-sanitised-by-default HTML; we further
  // post-process anchors so they open externally and never become same-origin
  // navigations the user didn't intend.
  const html = marked.parse(String(text));
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

function modelKindFilter(m) {
  return m.kind === "llm";
}

export default function StoreChatPage() {
  const router = useRouter();
  const [me, setMe] = useState(undefined); // undefined = loading, null = not logged
  const [models, setModels] = useState(null);
  const [state, setState] = useState({ activeId: null, items: {} });
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef(null);
  const bodyRef = useRef(null);
  const textareaRef = useRef(null);

  // Auth gate
  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.customer) {
          router.push(`/store/login?next=${encodeURIComponent("/store/chat")}`);
          return;
        }
        setMe(d.customer);
      })
      .catch(() => setMe(null));
  }, [router]);

  // Load models + local conversations
  useEffect(() => {
    if (!me) return;
    fetch("/api/store/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setModels((d.models || []).filter(modelKindFilter)))
      .catch(() => setModels([]));
    setState(loadAll());
  }, [me]);

  // Persist whenever state changes
  useEffect(() => {
    saveAll(state);
  }, [state]);

  // Auto-scroll on new content
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  });

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const conversations = useMemo(() => listConversations(state), [state]);
  const active = state.activeId ? state.items[state.activeId] : null;

  function pickDefaultModel() {
    if (!models || models.length === 0) return "";
    return models[0].fullId;
  }

  function newChat() {
    const conv = createConversation(active?.model || pickDefaultModel());
    setState((s) => setActive(upsertConversation(s, conv), conv.id));
    setInput("");
    setError("");
  }

  function selectChat(id) {
    setState((s) => setActive(s, id));
    setSidebarOpen(false);
    setError("");
  }

  function deleteChat(id) {
    if (!confirm("Xoá cuộc trò chuyện này?")) return;
    setState((s) => removeConversation(s, id));
  }

  function changeModel(modelId) {
    if (!active) {
      const conv = { ...createConversation(modelId) };
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
      return;
    }
    setState((s) => upsertConversation(s, { ...active, model: modelId }));
  }

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  async function send() {
    if (streaming) return;
    const text = input.trim();
    if (!text) return;

    let conv = active;
    if (!conv) {
      conv = createConversation(pickDefaultModel());
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
    }
    if (!conv.model) {
      setError("Hãy chọn model trước khi gửi");
      return;
    }

    setError("");
    setInput("");

    const userMsg = { role: "user", content: text };
    const assistantMsg = { role: "assistant", content: "" };
    let working = {
      ...conv,
      messages: [...conv.messages, userMsg, assistantMsg],
      title: conv.messages.length === 0 ? deriveTitle([userMsg]) : conv.title,
    };
    setState((s) => upsertConversation(s, working));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    try {
      const res = await fetch("/api/store/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: working.model,
          messages: working.messages
            .slice(0, -1) // drop trailing empty assistant
            .map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        let msg = txt;
        try {
          const j = JSON.parse(txt);
          msg = j?.error || j?.message || txt;
        } catch {}
        setError(msg || `HTTP ${res.status}`);
        // Drop the empty assistant placeholder
        working = { ...working, messages: working.messages.slice(0, -1) };
        setState((s) => upsertConversation(s, working));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE chunks separated by blank line
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = chunk
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta =
              json?.choices?.[0]?.delta?.content ??
              json?.choices?.[0]?.message?.content ??
              "";
            if (delta) {
              acc += delta;
              const msgs = [...working.messages];
              msgs[msgs.length - 1] = { role: "assistant", content: acc };
              working = { ...working, messages: msgs };
              setState((s) => upsertConversation(s, working));
            }
          } catch {
            // Skip malformed chunk
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(e.message || String(e));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  if (me === undefined) {
    return <div className="h-64 animate-pulse rounded-xl border border-border-subtle bg-surface" />;
  }
  if (me === null) return null;

  const noModels = models && models.length === 0;
  const currentModel = active?.model || pickDefaultModel();

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-10 grid h-[calc(100vh-64px)] grid-cols-1 md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-border-subtle bg-surface ${
          sidebarOpen ? "fixed inset-0 z-40 md:static md:inset-auto" : "hidden md:flex"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle p-3">
          <button
            onClick={newChat}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Cuộc trò chuyện mới
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden rounded-lg p-2 text-text-muted hover:bg-surface-2"
            aria-label="Đóng"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-text-muted">
              Chưa có cuộc trò chuyện nào.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {conversations.map((c) => {
                const isActive = c.id === state.activeId;
                return (
                  <li key={c.id}>
                    <div
                      className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                      }`}
                    >
                      <button
                        onClick={() => selectChat(c.id)}
                        className="flex flex-1 items-center gap-2 truncate text-left"
                      >
                        <span className="material-symbols-outlined text-base">chat</span>
                        <span className="truncate">{c.title}</span>
                      </button>
                      <button
                        onClick={() => deleteChat(c.id)}
                        className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                        aria-label="Xoá"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-border-subtle p-3">
          <Link
            href="/store/account/keys"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-muted hover:bg-surface-2 hover:text-text-main"
          >
            <span className="material-symbols-outlined text-base">vpn_key</span>
            API Keys
          </Link>
        </div>
      </aside>

      {/* Chat area */}
      <section className="flex min-w-0 flex-col bg-bg">
        <header className="flex items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden rounded-lg p-1.5 text-text-muted hover:bg-surface-2"
            aria-label="Mở danh sách"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <div className="flex flex-1 items-center gap-2">
            <span className="material-symbols-outlined text-primary">forum</span>
            <h1 className="text-sm font-semibold">Chat playground</h1>
          </div>
          {noModels ? (
            <Link
              href="/store/pricing"
              className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
            >
              Mua gói để mở khoá model
            </Link>
          ) : (
            <select
              value={currentModel}
              onChange={(e) => changeModel(e.target.value)}
              className="max-w-[260px] rounded-lg border border-border bg-surface px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
            >
              {models?.map((m) => (
                <option key={m.fullId} value={m.fullId}>
                  {m.providerName} · {m.name}
                </option>
              ))}
            </select>
          )}
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-6">
          {!active || active.messages.length === 0 ? (
            <EmptyState noModels={noModels} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {active.messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}
              {streaming && (
                <p className="text-xs text-text-muted">
                  <span className="inline-block animate-pulse">●</span> Đang trả lời…
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-border-subtle bg-surface px-4 py-3">
          {error && (
            <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {error}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={noModels ? "Bạn chưa có gói nào…" : "Nhắn gì đó (Enter để gửi, Shift+Enter xuống dòng)"}
              disabled={noModels}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-60"
            />
            {streaming ? (
              <button
                onClick={stopStream}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2"
              >
                <span className="material-symbols-outlined text-base">stop</span>
                Dừng
              </button>
            ) : (
              <button
                onClick={send}
                disabled={noModels || !input.trim()}
                className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">send</span>
                Gửi
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function EmptyState({ noModels }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-16 text-center">
      <span className="material-symbols-outlined text-5xl text-primary">forum</span>
      <h2 className="text-lg font-semibold">Chat với model trong gói của bạn</h2>
      <p className="text-sm text-text-muted">
        {noModels
          ? "Chưa có model nào khả dụng. Mua một gói để bắt đầu chat."
          : "Chọn model phía trên rồi nhập câu hỏi. Lịch sử trò chuyện được lưu trên trình duyệt này."}
      </p>
      {noModels && (
        <Link
          href="/store/pricing"
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          Xem bảng giá
        </Link>
      )}
    </div>
  );
}

function MessageBubble({ role, content }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-white whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <span className="material-symbols-outlined text-base">smart_toy</span>
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border-subtle bg-surface px-4 py-2 text-sm">
        {content ? (
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        ) : (
          <span className="text-text-muted text-xs">…</span>
        )}
      </div>
    </div>
  );
}
