import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight — returns headers only for allowlisted origins.
 */
export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}

