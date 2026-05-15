import { handleFetch } from "@/sse/handlers/fetch.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * POST /v1/web/fetch - Web URL fetch/extract endpoint
 */
export async function POST(request) {
  return await handleFetch(request);
}
