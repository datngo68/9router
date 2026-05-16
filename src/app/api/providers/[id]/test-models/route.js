import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { CLI_TOKEN_HEADER, getCliToken } from "@/lib/auth/cliToken";

/**
 * Ping a single model via internal completions endpoint (OpenAI format).
 * open-sse handles all provider translation automatically.
 *
 * Auth: we attach the loopback CLI token so the chat handler bypasses
 * `requireApiKey` for this internal call. Raw API keys are no longer
 * retrievable from the DB after the keyHash migration.
 */
async function pingModel(modelId, baseUrl, cliToken) {
  const start = Date.now();
  try {
    const headers = { "Content-Type": "application/json" };
    if (cliToken) headers[CLI_TOKEN_HEADER] = cliToken;
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    // 200 = working; 400 = bad request but auth passed (model reachable)
    const ok = res.status === 200 || res.status === 400;
    let error = null;
    if (!ok) {
      const text = await res.text().catch(() => "");
      error = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`;
    }
    return { ok, latencyMs, error };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * POST /api/providers/[id]/test-models
 * id = connectionId — used only to resolve provider + model list.
 * Actual requests go through /api/v1/chat/completions (open-sse handles everything).
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

    let models = getProviderModels(alias);

    const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

    // Compatible providers: fetch live model list
    if (isCompatible && models.length === 0) {
      try {
        const modelsRes = await fetch(`${baseUrl}/api/providers/${id}/models`);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          models = (data.models || []).map((m) => ({ id: m.id || m.name, name: m.name || m.id }));
        }
      } catch { /* fallback to empty */ }
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "No models configured for this provider" }, { status: 400 });
    }

    const cliToken = await getCliToken();

    // Warm up with first model to trigger token refresh (if needed) before parallel calls.
    // This prevents race condition where multiple requests concurrently refresh the same token.
    const [first, ...rest] = models;
    const firstResult = await pingModel(`${alias}/${first.id}`, baseUrl, cliToken);
    const results = [{ modelId: first.id, name: first.name || first.id, ...firstResult }];

    if (rest.length > 0) {
      const restResults = await Promise.all(
        rest.map(async (model) => {
          const result = await pingModel(`${alias}/${model.id}`, baseUrl, cliToken);
          return { modelId: model.id, name: model.name || model.id, ...result };
        })
      );
      results.push(...restResults);
    }

    return NextResponse.json({ provider: providerId, connectionId: id, results });
  } catch (error) {
    console.log("Error testing models:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
