"use client";

import { useState } from "react";

const ENDPOINTS = [
  { method: "POST", path: "/v1/chat/completions", desc: "OpenAI Chat Completions format. Hỗ trợ streaming, tools, vision, reasoning." },
  { method: "POST", path: "/v1/messages", desc: "Anthropic Messages format. Hỗ trợ thinking, tool_use, system blocks." },
  { method: "POST", path: "/v1/responses", desc: "OpenAI Responses API. Tự động translate sang format Codex/Anthropic nếu cần." },
  { method: "POST", path: "/v1/embeddings", desc: "Tạo embeddings cho RAG / semantic search." },
  { method: "POST", path: "/v1/images/generations", desc: "Image generation (Gemini, OpenAI, Stability, Cloudflare AI...)." },
  { method: "POST", path: "/v1/audio/speech", desc: "Text-to-speech (ElevenLabs, OpenAI, Deepgram, Inworld...)." },
  { method: "POST", path: "/v1/audio/transcriptions", desc: "Speech-to-text (Whisper compatible)." },
  { method: "POST", path: "/v1/search", desc: "Web search (Tavily, Linkup, Google Programmable Search, You.com...)." },
  { method: "POST", path: "/v1/web/fetch", desc: "Fetch + extract URL (Firecrawl, Jina, Tavily, Exa)." },
  { method: "GET",  path: "/v1/models", desc: "List models khả dụng cho key của bạn." },
];

const SNIPPETS = {
  curl: `curl https://your-9router.com/v1/chat/completions \\
  -H "Authorization: Bearer $NINEROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'`,
  "openai-py": `from openai import OpenAI

client = OpenAI(
    base_url="https://your-9router.com/v1",
    api_key="$NINEROUTER_KEY",
)

resp = client.chat.completions.create(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`,
  "openai-node": `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-9router.com/v1",
  apiKey: process.env.NINEROUTER_KEY,
});

const resp = await client.chat.completions.create({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(resp.choices[0].message.content);`,
  "anthropic-py": `import anthropic

client = anthropic.Anthropic(
    base_url="https://your-9router.com",
    api_key="$NINEROUTER_KEY",
)

resp = client.messages.create(
    model="anthropic/claude-sonnet-4.5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.content[0].text)`,
};

const RATE_HEADERS = [
  { name: "X-Api-Key-Token-Limit", desc: "Daily token cap của key (0 = không giới hạn)." },
  { name: "X-Api-Key-Token-Used", desc: "Số token đã dùng hôm nay (cộng cả prompt + completion)." },
  { name: "X-Api-Key-Token-Remaining", desc: "Số token còn lại trong ngày hôm nay." },
  { name: "X-Api-Key-Token-Reset", desc: "ISO timestamp khi quota daily reset (đầu ngày local)." },
  { name: "X-Api-Key-Rate-Limit / Rate-Remaining", desc: "Sliding 60s window cho RPM (nếu được set trong gói)." },
  { name: "X-Api-Key-Month-* / Lifetime-*", desc: "Quota theo tháng / lifetime cho gói tương ứng." },
  { name: "Retry-After", desc: "Khi 429 — số giây nên đợi trước khi retry." },
];

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 text-xs leading-relaxed"><code>{children}</code></pre>
      <button
        onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute right-2 top-2 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text-muted hover:text-primary"
      >{copied ? "Đã copy" : "Copy"}</button>
    </div>
  );
}

export default function DocsPage() {
  const [snippet, setSnippet] = useState("curl");

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">API Docs</h1>
        <p className="mt-2 max-w-3xl text-text-muted">9Router tương thích với OpenAI, Anthropic, Gemini SDK và bất kỳ HTTP client nào. Đặt <code className="text-primary">base_url</code> trỏ tới gateway của bạn, dùng API key được phát từ portal.</p>
      </header>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Authentication</h2>
        <p className="text-sm text-text-muted">Mọi request gửi header <code className="text-primary">Authorization: Bearer &lt;key&gt;</code> hoặc <code className="text-primary">x-api-key</code> (Anthropic style).</p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Quick start</h2>
        <div className="mb-3 inline-flex rounded-lg border border-border p-1">
          {[
            { id: "curl", label: "curl" },
            { id: "openai-py", label: "OpenAI Python" },
            { id: "openai-node", label: "OpenAI Node" },
            { id: "anthropic-py", label: "Anthropic Python" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSnippet(t.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${snippet === t.id ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >{t.label}</button>
          ))}
        </div>
        <CodeBlock>{SNIPPETS[snippet]}</CodeBlock>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Endpoints</h2>
        <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-2 text-left">Method</th>
                <th className="px-4 py-2 text-left">Path</th>
                <th className="px-4 py-2 text-left">Mô tả</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-t border-border-subtle">
                  <td className="px-4 py-2 font-mono text-xs text-primary">{e.method}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.path}</td>
                  <td className="px-4 py-2 text-text-muted">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Quota response headers</h2>
        <p className="mb-3 text-sm text-text-muted">Mỗi response trả về các header sau giúp bạn theo dõi quota mà không cần hit endpoint riêng:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {RATE_HEADERS.map((h) => (
            <div key={h.name} className="rounded-lg border border-border-subtle bg-surface p-4">
              <code className="text-xs font-mono text-primary">{h.name}</code>
              <p className="mt-1 text-sm text-text-muted">{h.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Streaming</h2>
        <p className="mb-3 text-sm text-text-muted">Set <code className="text-primary">stream: true</code> trong body. Server gửi SSE chuẩn format theo endpoint:</p>
        <ul className="list-disc pl-6 text-sm text-text-muted">
          <li><code>/v1/chat/completions</code> → OpenAI SSE (<code>data: {"{...}"}</code>, kết thúc <code>data: [DONE]</code>)</li>
          <li><code>/v1/messages</code> → Anthropic event stream (<code>event: message_start</code>, ...)</li>
          <li><code>/v1/responses</code> → OpenAI Responses event stream</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Errors</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { code: "401", desc: "API key không hợp lệ / hết hạn / paused." },
            { code: "403", desc: "Lifetime cap đã đạt, hoặc model/IP không nằm trong allowlist của key." },
            { code: "429", desc: "Vượt quota daily/monthly hoặc rate limit RPM. Xem `Retry-After`." },
            { code: "400", desc: "Body sai schema, max_tokens vượt cap, hoặc model không tồn tại." },
            { code: "502", desc: "Provider upstream lỗi sau khi retry/fallback." },
            { code: "503", desc: "Tất cả account của provider đều đang cooldown." },
          ].map((e) => (
            <div key={e.code} className="rounded-lg border border-border-subtle bg-surface p-4">
              <p className="text-lg font-semibold text-primary">{e.code}</p>
              <p className="text-sm text-text-muted">{e.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
