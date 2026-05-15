import { handleTts } from "@/sse/handlers/tts.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/** POST /v1/audio/speech - OpenAI-compatible TTS endpoint */
export async function POST(request) {
  return await handleTts(request);
}
