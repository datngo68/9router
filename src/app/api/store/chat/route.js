// Internal proxy: customer (logged in via cookie session) → handleChat / handleImageGeneration.
//
// The raw API key is never returned to the browser (DB only stores keyHash),
// so the storefront chat page POSTs here with cookie auth. We resolve the
// customer's first active key, hand the record off to handler via the
// `preloadedApiKeyRecord` option, and let the gateway run the same policy
// stack (quota, RPM, model allowlist) it would for any external call.
//
// Branching: we look up `body.model` in PROVIDER_MODELS to detect its `type`
// (llm | image) and forward to the matching handler with the correct virtual
// endpoint so format/translator detection works.

import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/customerSession";
import { getApiKeysByCustomer, getApiKeyById } from "@/lib/localDb";
import { handleChat } from "@/sse/handlers/chat.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

export const dynamic = "force-dynamic";

let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

// Map full model id (e.g. "cx/gpt-5.5-image") → kind ("llm" | "image" | ...).
// Falls back to "llm" when the model isn't in catalog so we don't break custom
// providers; the downstream handler will surface a clearer error.
function detectModelKind(fullId) {
  if (typeof fullId !== "string") return "llm";
  const slash = fullId.indexOf("/");
  if (slash <= 0) return "llm";
  const alias = fullId.slice(0, slash);
  const id = fullId.slice(slash + 1);
  const list = PROVIDER_MODELS[alias];
  if (!Array.isArray(list)) return "llm";
  const m = list.find((x) => x.id === id);
  return m?.type || "llm";
}

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

export async function POST(request) {
  const session = await getCurrentCustomer(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await getApiKeysByCustomer(session.customer.id);
  const now = Date.now();
  const usable = keys.find(
    (k) => k.isActive && (!k.expiresAt || new Date(k.expiresAt).getTime() > now)
  );
  if (!usable) {
    return NextResponse.json(
      { error: "Bạn chưa có API key đang hoạt động. Vui lòng mua gói hoặc kích hoạt key trước khi chat." },
      { status: 403 }
    );
  }

  // Reload the full record by id to make sure all policy fields are normalized
  // exactly the way handlers expect (rowToKey shape).
  const apiKeyRecord = await getApiKeyById(usable.id);
  if (!apiKeyRecord) {
    return NextResponse.json({ error: "Không tải được API key" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) return NextResponse.json({ error: "Thiếu model" }, { status: 400 });

  await ensureInitialized();

  const kind = detectModelKind(model);

  // ---------------- Image generation branch ----------------
  if (kind === "image") {
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      return NextResponse.json({ error: "Thiếu prompt" }, { status: 400 });
    }

    const fwdUrl = new URL("/api/v1/images/generations", request.url);
    const fwdBody = { model, prompt };
    if (body.n != null) fwdBody.n = body.n;
    if (body.size) fwdBody.size = body.size;
    if (body.quality) fwdBody.quality = body.quality;
    if (body.background) fwdBody.background = body.background;
    if (body.output_format) fwdBody.output_format = body.output_format;
    if (body.image_detail) fwdBody.image_detail = body.image_detail;
    if (typeof body.image === "string" && body.image) fwdBody.image = body.image;

    const fwd = new Request(fwdUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user-agent": request.headers.get("user-agent") || "9router-store-chat",
      },
      body: JSON.stringify(fwdBody),
    });

    return await handleImageGeneration(fwd, { preloadedApiKeyRecord: apiKeyRecord });
  }

  // ---------------- LLM chat branch (default) ----------------
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "Thiếu messages" }, { status: 400 });
  }

  // Build a forwarded request that looks like /api/v1/chat/completions so
  // detectFormatByEndpoint inside handleChat picks the OpenAI translator.
  const fwdUrl = new URL("/api/v1/chat/completions", request.url);
  const fwdBody = {
    model,
    messages,
    stream: body.stream !== false,
  };
  if (body.temperature != null) fwdBody.temperature = body.temperature;
  if (body.max_tokens != null) fwdBody.max_tokens = body.max_tokens;

  const fwd = new Request(fwdUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": request.headers.get("user-agent") || "9router-store-chat",
    },
    body: JSON.stringify(fwdBody),
  });

  return await handleChat(fwd, null, { preloadedApiKeyRecord: apiKeyRecord });
}
