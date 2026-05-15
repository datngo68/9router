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
 * POST /v1/responses - OpenAI Responses API format
 */
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}
