// Format identifiers
export const FORMATS = {
  OPENAI: "openai",
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_RESPONSE: "openai-response",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GEMINI_CLI: "gemini-cli",
  VERTEX: "vertex",
  CODEX: "codex",
  ANTIGRAVITY: "antigravity",
  KIRO: "kiro",
  CURSOR: "cursor",
  OLLAMA: "ollama",
  COMMANDCODE: "commandcode"
};

/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(pathname, body) {
  // /v1/responses: default to Responses API, but disambiguate by body shape.
  // Some clients (Postman tests, OpenAI SDK misuse) hit /v1/responses with a
  // Chat Completions body (messages[] without input[]). Treat those as plain
  // OpenAI so the translator runs `openai → openai-responses` and converts
  // messages → input before the Codex executor sees the body.
  if (pathname.includes("/v1/responses")) {
    if (!body?.input && Array.isArray(body?.messages)) return FORMATS.OPENAI;
    return FORMATS.OPENAI_RESPONSES;
  }

  // /v1/messages is always Claude
  if (pathname.includes("/v1/messages")) return FORMATS.CLAUDE;

  // /v1/chat/completions + input[] → treat as openai (Cursor CLI sends Responses body via chat endpoint)
  if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
    return FORMATS.OPENAI;
  }

  return null;
}

