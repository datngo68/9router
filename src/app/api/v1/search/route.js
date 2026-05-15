import { handleSearch } from "@/sse/handlers/search.js";
import { handleCorsPreflight } from "@/sse/utils/cors.js";

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * POST /v1/search - Web search endpoint
 */
export async function POST(request) {
  return await handleSearch(request);
}
