import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db/repos/pricingRepo.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

// GET /api/store/models — flatten model catalog with pricing
//
// Output shape: array of
//   {
//     provider, providerName, providerAlias,
//     id, name, kind,
//     input, output, cached, reasoning, cacheCreation,    // $ / 1M tokens
//     contextWindow, capabilities, options
//   }
//
// Pricing is merged from `PROVIDER_PRICING` constant + DB overrides via
// pricingRepo.getPricing.
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const filterProvider = url.searchParams.get("provider");
    const search = url.searchParams.get("q")?.toLowerCase();

    const merged = await getPricing();
    const out = [];

    for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
      const providerInfo = AI_PROVIDERS[alias] || {};
      if (filterProvider && filterProvider !== alias && filterProvider !== providerInfo.id) continue;
      const providerName = providerInfo.name || alias;
      const providerKey = providerInfo.id || alias;

      for (const m of models) {
        if (m.hidden) continue;
        if (search && !`${alias}/${m.id}`.toLowerCase().includes(search) && !(m.name || "").toLowerCase().includes(search)) continue;
        const pricing = merged[providerKey]?.[m.id] || merged[alias]?.[m.id] || null;
        out.push({
          provider: providerKey,
          providerAlias: alias,
          providerName,
          id: m.id,
          name: m.name || m.id,
          kind: m.type || "llm",
          fullId: `${alias}/${m.id}`,
          input: pricing?.input ?? null,
          output: pricing?.output ?? null,
          cached: pricing?.cached ?? null,
          reasoning: pricing?.reasoning ?? null,
          cacheCreation: pricing?.cache_creation ?? null,
          contextWindow: m.contextWindow ?? null,
          capabilities: m.capabilities ?? null,
          options: m.options ?? null,
        });
      }
    }

    return NextResponse.json({ models: out });
  } catch (e) {
    console.log("[/api/store/models] error:", e.message);
    return NextResponse.json({ models: [] }, { status: 500 });
  }
}
