import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/** POST /v1/images/generations - OpenAI-compatible image generation endpoint */
export async function POST(request) {
  return await handleImageGeneration(request);
}
