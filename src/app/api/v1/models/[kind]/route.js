import { buildModelsList } from "../route.js";
import { buildCorsHeaders, handleCorsPreflight } from "@/sse/utils/cors.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

export async function OPTIONS(request) {
  return await handleCorsPreflight(request);
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 */
export async function GET(request, { params }) {
  const cors = await buildCorsHeaders(request);
  try {
    const { kind } = await params;
    const kindFilter = KIND_SLUG_MAP[kind];

    if (!kindFilter) {
      return Response.json(
        {
          error: {
            message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 404, headers: cors }
      );
    }

    const data = await buildModelsList(kindFilter);
    return Response.json({ object: "list", data }, { headers: cors });
  } catch (error) {
    console.log("Error fetching models by kind:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: cors }
    );
  }
}
