import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
export async function POST(request) {
  return await handleEmbeddings(request);
}
