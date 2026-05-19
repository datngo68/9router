"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { readAnyFile, classifyFile, formatBytes } from "./_files";
import { renderSafeMarkdown } from "@/shared/utils/sanitizeMarkdown";

function renderMarkdown(text) {
  // Untrusted: messages may include LLM output. sanitizeMarkdown wraps marked +
  // DOMPurify so any <script>/<img onerror>/inline handlers are stripped before
  // we hand the HTML to dangerouslySetInnerHTML.
  return renderSafeMarkdown(text);
}

function isLlm(m) { return m.kind === "llm"; }
function isImage(m) { return m.kind === "image"; }

// Build OpenAI-compatible content for an LLM call out of a text prompt and
// the user's local attachments. Image attachments → image_url blocks. Text/PDF
// extracts get prepended to the prompt as fenced blocks (cheap, no extra
// modality). Returns either a string (no attachments) or an array of blocks.
function buildLlmContent(text, attachments) {
  const imageAtts = attachments.filter((a) => a.kind === "image" && a.dataUrl);
  const textAtts = attachments.filter((a) => a.kind === "text" && a.text);

  let promptText = text;
  if (textAtts.length > 0) {
    const blocks = textAtts
      .map((a) => `\`\`\`file:${a.name}\n${a.text}\n\`\`\``)
      .join("\n\n");
    promptText = `${blocks}\n\n${text}`.trim();
  }

  if (imageAtts.length === 0) {
    return promptText;
  }

  const content = [];
  if (promptText) content.push({ type: "text", text: promptText });
  for (const a of imageAtts) {
    content.push({ type: "image_url", image_url: { url: a.dataUrl } });
  }
  return content;
}

// Strip image_url blocks from history before sending: providers vary in vision
// support and the dataURLs blow up payload size. We send them only on the
// most recent user turn (where they were attached); prior turns get text only.
function stripImagesForHistory(messages) {
  return messages.map((m) => {
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return { role: m.role, content: text };
    }
    return { role: m.role, content: m.content };
  });
}

export default function StoreChatPage() {
  const router = useRouter();
  const [me, setMe] = useState(undefined); // undefined = loading, null = not logged
  const [models, setModels] = useState(null);
  const [state, setState] = useState({ activeId: null, items: {} });
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef(null);
  const bodyRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

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
      .then((d) => setModels(d.models || []))
      .catch(() => setModels([]));
    setState(loadAll());
  }, [me]);

  // Persist whenever state changes
  useEffect(() => {
    const r = saveAll(state);
    if (r.pruned) {
      setInfo("Bộ nhớ trình duyệt gần đầy — đã rút gọn ảnh trong các cuộc trò chuyện cũ.");
    }
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

  const llmModels = useMemo(() => (models || []).filter(isLlm), [models]);
  const imageModels = useMemo(() => (models || []).filter(isImage), [models]);

  function pickDefaultLlm() {
    return llmModels[0]?.fullId || "";
  }

  function newChat() {
    const conv = createConversation(active?.mode === "llm" ? active.model : pickDefaultLlm(), "llm");
    setState((s) => setActive(upsertConversation(s, conv), conv.id));
    setInput("");
    setAttachments([]);
    setError("");
  }

  function selectChat(id) {
    setState((s) => setActive(s, id));
    setSidebarOpen(false);
    setError("");
    setAttachments([]);
  }

  function deleteChat(id) {
    if (!confirm("Xoá cuộc trò chuyện này?")) return;
    setState((s) => removeConversation(s, id));
  }

  function changeModel(modelId) {
    if (!active) {
      const conv = { ...createConversation(modelId, "llm") };
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
      return;
    }
    setState((s) => upsertConversation(s, { ...active, model: modelId }));
  }

  function startImageMode() {
    if (imageModels.length === 0) {
      setError("Gói hiện tại chưa có model tạo ảnh.");
      return;
    }
    const imageModel = imageModels[0].fullId;
    if (!active || active.mode !== "image" || active.messages.length > 0) {
      const conv = createConversation(imageModel, "image");
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
    } else {
      setState((s) => upsertConversation(s, { ...active, model: imageModel }));
    }
    setError("");
    setAttachments([]);
  }

  function backToChat() {
    if (!active) return;
    if (active.messages.length === 0) {
      setState((s) => upsertConversation(s, { ...active, mode: "llm", model: pickDefaultLlm() }));
    } else {
      const conv = createConversation(pickDefaultLlm(), "llm");
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
    }
    setError("");
    setAttachments([]);
  }

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setReadingFiles(true);
    setError("");
    const next = [];
    for (const f of files) {
      const kind = classifyFile(f);
      if (kind === "unknown") {
        setError(`Không hỗ trợ file ${f.name}`);
        continue;
      }
      try {
        const att = await readAnyFile(f);
        if (att) next.push(att);
      } catch (err) {
        setError(`Lỗi đọc ${f.name}: ${err?.message || err}`);
      }
    }
    setReadingFiles(false);
    if (next.length > 0) setAttachments((cur) => [...cur, ...next]);
  }

  function removeAttachment(id) {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  async function send() {
    if (streaming || readingFiles) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    let conv = active;
    if (!conv) {
      conv = createConversation(pickDefaultLlm(), "llm");
      setState((s) => setActive(upsertConversation(s, conv), conv.id));
    }
    if (!conv.model) {
      setError("Hãy chọn model trước khi gửi");
      return;
    }
    if (conv.mode === "image" && !text) {
      setError("Hãy nhập mô tả ảnh muốn tạo");
      return;
    }

    setError("");
    setInput("");
    const sentAttachments = attachments;
    setAttachments([]);

    if (conv.mode === "image") {
      await sendImage(conv, text, sentAttachments);
    } else {
      await sendChat(conv, text, sentAttachments);
    }
  }

  async function sendChat(conv, text, sentAttachments) {
    const content = buildLlmContent(text, sentAttachments);
    const userMsg = { role: "user", content, attachments: sentAttachments };
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
      // Send full image_url only on the latest turn; older turns become text-only.
      const history = stripImagesForHistory(working.messages.slice(0, -2));
      const lastUser = { role: "user", content };
      const messagesForRequest = [...history, lastUser];

      const res = await fetch("/api/store/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: working.model,
          messages: messagesForRequest,
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

  async function sendImage(conv, text, sentAttachments) {
    const userMsg = { role: "user", content: text, attachments: sentAttachments };
    const assistantMsg = { role: "assistant", content: "", images: [] };
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
      const firstImage = sentAttachments.find((a) => a.kind === "image" && a.dataUrl);
      const reqBody = { model: working.model, prompt: text };
      if (firstImage) reqBody.image = firstImage.dataUrl;

      const res = await fetch("/api/store/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error || json?.message || `HTTP ${res.status}`;
        setError(typeof msg === "string" ? msg : JSON.stringify(msg));
        working = { ...working, messages: working.messages.slice(0, -1) };
        setState((s) => upsertConversation(s, working));
        return;
      }

      const data = Array.isArray(json?.data) ? json.data : [];
      const images = data.map((d) => {
        const out = { mime: "image/png" };
        if (d?.b64_json) out.b64 = d.b64_json;
        if (d?.url) out.url = d.url;
        if (d?.revised_prompt) out.revisedPrompt = d.revised_prompt;
        return out;
      });
      const summary = images.length > 0
        ? `Đã tạo ${images.length} ảnh.`
        : "Provider không trả về ảnh nào.";
      const msgs = [...working.messages];
      msgs[msgs.length - 1] = { role: "assistant", content: summary, images };
      working = { ...working, messages: msgs };
      setState((s) => upsertConversation(s, working));
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

  const noLlmModels = models && llmModels.length === 0;
  const isImageMode = active?.mode === "image";
  const currentModel = active?.model || pickDefaultLlm();
  const placeholder = isImageMode
    ? "Mô tả ảnh muốn tạo (kèm ảnh nếu muốn chỉnh sửa)…"
    : noLlmModels
      ? "Bạn chưa có gói nào…"
      : "Nhắn gì đó (Enter để gửi, Shift+Enter xuống dòng)";

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
                        <span className="material-symbols-outlined text-base">
                          {c.mode === "image" ? "image" : "chat"}
                        </span>
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
            <span className="material-symbols-outlined text-primary">
              {isImageMode ? "image" : "forum"}
            </span>
            <h1 className="text-sm font-semibold">
              {isImageMode ? "Image playground" : "Chat playground"}
            </h1>
          </div>

          {isImageMode ? (
            <>
              <span className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted">
                {imageModels.find((m) => m.fullId === active?.model)?.name || active?.model}
              </span>
              <button
                onClick={backToChat}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-2"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Chat
              </button>
            </>
          ) : noLlmModels ? (
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
              {llmModels.map((m) => (
                <option key={m.fullId} value={m.fullId}>
                  {m.providerName} · {m.name}
                </option>
              ))}
            </select>
          )}
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-6">
          {!active || active.messages.length === 0 ? (
            <EmptyState noModels={noLlmModels} isImageMode={isImageMode} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {active.messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
              {streaming && (
                <p className="text-xs text-text-muted">
                  <span className="inline-block animate-pulse">●</span>{" "}
                  {isImageMode ? "Đang tạo ảnh…" : "Đang trả lời…"}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-border-subtle bg-surface px-4 py-3">
          {info && (
            <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              <span className="material-symbols-outlined text-sm">info</span>
              <span className="flex-1">{info}</span>
              <button onClick={() => setInfo("")} className="text-amber-600 hover:opacity-70">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}
          {error && (
            <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {error}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} att={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}

          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,text/*,.md,.json,.csv,.tsv,.log,.yaml,.yml,.ini,.conf,.env,.js,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.html,.css,.xml,.sql,application/pdf"
              onChange={onPickFiles}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={readingFiles || streaming}
              className="rounded-lg border border-border p-2 text-text-muted hover:bg-surface-2 disabled:opacity-50"
              title="Đính kèm file (ảnh, text, PDF)"
              aria-label="Đính kèm"
            >
              <span className="material-symbols-outlined text-base">
                {readingFiles ? "hourglass_empty" : "attach_file"}
              </span>
            </button>
            {!isImageMode && (
              <button
                onClick={startImageMode}
                disabled={imageModels.length === 0 || streaming}
                className="rounded-lg border border-border p-2 text-text-muted hover:bg-surface-2 disabled:opacity-50"
                title={
                  imageModels.length === 0
                    ? "Gói chưa có model tạo ảnh"
                    : "Tạo ảnh từ prompt"
                }
                aria-label="Tạo ảnh"
              >
                <span className="material-symbols-outlined text-base">image</span>
              </button>
            )}
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
              placeholder={placeholder}
              disabled={!isImageMode && noLlmModels}
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
                disabled={
                  readingFiles ||
                  (!isImageMode && noLlmModels) ||
                  (!input.trim() && attachments.length === 0)
                }
                className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">
                  {isImageMode ? "auto_awesome" : "send"}
                </span>
                {isImageMode ? "Tạo" : "Gửi"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function EmptyState({ noModels, isImageMode }) {
  if (isImageMode) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-16 text-center">
        <span className="material-symbols-outlined text-5xl text-primary">image</span>
        <h2 className="text-lg font-semibold">Tạo ảnh từ mô tả</h2>
        <p className="text-sm text-text-muted">
          Nhập mô tả vào ô bên dưới rồi bấm Tạo. Có thể đính kèm 1 ảnh nếu model hỗ trợ chỉnh sửa.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-16 text-center">
      <span className="material-symbols-outlined text-5xl text-primary">forum</span>
      <h2 className="text-lg font-semibold">Chat với model trong gói của bạn</h2>
      <p className="text-sm text-text-muted">
        {noModels
          ? "Chưa có model nào khả dụng. Mua một gói để bắt đầu chat."
          : "Chọn model phía trên rồi nhập câu hỏi. Có thể đính kèm ảnh, file text, PDF; bấm nút ảnh để tạo ảnh. Lịch sử lưu trên trình duyệt này."}
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

function AttachmentChip({ att, onRemove }) {
  if (att.kind === "image" && att.dataUrl) {
    return (
      <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
        <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
        <button
          onClick={onRemove}
          className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-black/60 text-white"
          aria-label="Xoá"
        >
          <span className="material-symbols-outlined text-xs">close</span>
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs">
      <span className="material-symbols-outlined text-base text-text-muted">
        {att.mime === "application/pdf" ? "picture_as_pdf" : "description"}
      </span>
      <div className="flex flex-col">
        <span className="max-w-[160px] truncate font-medium">{att.name}</span>
        <span className="text-[10px] text-text-muted">{formatBytes(att.size)}</span>
      </div>
      <button onClick={onRemove} className="text-text-muted hover:text-red-500" aria-label="Xoá">
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function downloadImage(img, idx) {
  let href = "";
  if (img.b64) {
    href = `data:${img.mime || "image/png"};base64,${img.b64}`;
  } else if (img.url) {
    href = img.url;
  } else {
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = `generated-${Date.now()}-${idx}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function MessageBubble({ message }) {
  const { role, attachments = [], images = [] } = message;
  const text = getMessageText(message.content);

  if (role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {text && (
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-white whitespace-pre-wrap">
            {text}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {attachments.map((a) => (
              <UserAttachmentTile key={a.id} att={a} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <span className="material-symbols-outlined text-base">smart_toy</span>
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border-subtle bg-surface px-4 py-2 text-sm">
        {text ? (
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : null}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {images.map((img, i) => (
              <AssistantImageTile key={i} img={img} idx={i} />
            ))}
          </div>
        )}
        {!text && images.length === 0 && (
          <span className="text-text-muted text-xs">…</span>
        )}
      </div>
    </div>
  );
}

function UserAttachmentTile({ att }) {
  if (att.kind === "image" && att.dataUrl) {
    return (
      <a href={att.dataUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={att.dataUrl}
          alt={att.name}
          className="h-32 w-32 rounded-lg border border-border object-cover"
        />
      </a>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs">
      <span className="material-symbols-outlined text-base text-text-muted">
        {att.mime === "application/pdf" ? "picture_as_pdf" : "description"}
      </span>
      <div className="flex flex-col">
        <span className="max-w-[200px] truncate font-medium">{att.name}</span>
        <span className="text-[10px] text-text-muted">{formatBytes(att.size)}</span>
      </div>
    </div>
  );
}

function AssistantImageTile({ img, idx }) {
  if (img.stripped) {
    return (
      <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-border bg-surface-2 text-xs text-text-muted">
        Ảnh đã được rút gọn
      </div>
    );
  }
  let src = "";
  if (img.b64) {
    src = `data:${img.mime || "image/png"};base64,${img.b64}`;
  } else if (img.url) {
    src = img.url;
  }
  if (!src) return null;
  return (
    <div className="flex flex-col gap-1">
      <a href={src} target="_blank" rel="noreferrer" className="block">
        <img
          src={src}
          alt="generated"
          className="max-h-80 max-w-full rounded-lg border border-border"
        />
      </a>
      <button
        onClick={() => downloadImage(img, idx)}
        className="flex items-center gap-1 self-start rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
      >
        <span className="material-symbols-outlined text-sm">download</span>
        Tải xuống
      </button>
    </div>
  );
}
