import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
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

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

export async function POST(request) {  
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

