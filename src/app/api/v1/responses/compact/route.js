import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * POST /v1/responses/compact - Compact conversation context
 */
export async function POST(request) {
  await ensureInitialized();
  const body = await request.json();
  body._compact = true;
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body)
  });
  return await handleChat(newRequest);
}
