import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db/repos/pricingRepo.js";
import { getPricingPlans } from "@/lib/db/repos/pricingPlansRepo.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

// GET /api/store/models — flatten model catalog with pricing
//
// Only returns models that are actually offered by at least one active pricing
// plan. If any active plan has an empty `allowedModels` (= unrestricted), the
// full catalog is returned. Each model includes a `plans` array listing the
// plans (id, name, kind) that include it, so the storefront can show which
// gói cover từng model.
//
// Output shape: array of
//   {
//     provider, providerName, providerAlias,
//     id, name, kind,
//     input, output, cached, reasoning, cacheCreation,    // $ / 1M tokens
//     contextWindow, capabilities, options,
//     plans: [{ id, name, kind }],
//   }
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const filterProvider = url.searchParams.get("provider");
    const search = url.searchParams.get("q")?.toLowerCase();

    const [merged, plans] = await Promise.all([
      getPricing(),
      getPricingPlans({ activeOnly: true }).catch(() => []),
    ]);

    // Build allowed-set from plans. If any plan has empty allowedModels, treat
    // as "all models" (no restriction).
    let unrestricted = false;
    const allowedSet = new Set();
    const plansByModel = new Map(); // fullId -> [{id,name,kind}]
    for (const p of plans) {
      const list = Array.isArray(p.allowedModels) ? p.allowedModels : [];
      if (list.length === 0) {
        unrestricted = true;
      } else {
        for (const fullId of list) {
          allowedSet.add(fullId);
          if (!plansByModel.has(fullId)) plansByModel.set(fullId, []);
          plansByModel.get(fullId).push({ id: p.id, name: p.name, kind: p.kind });
        }
      }
    }

    const out = [];

    for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
      const providerInfo = AI_PROVIDERS[alias] || {};
      if (filterProvider && filterProvider !== alias && filterProvider !== providerInfo.id) continue;
      const providerName = providerInfo.name || alias;
      const providerKey = providerInfo.id || alias;

      for (const m of models) {
        if (m.hidden) continue;
        const fullId = `${alias}/${m.id}`;
        if (!unrestricted && !allowedSet.has(fullId)) continue;
        if (search && !fullId.toLowerCase().includes(search) && !(m.name || "").toLowerCase().includes(search)) continue;
        const pricing = merged[providerKey]?.[m.id] || merged[alias]?.[m.id] || null;
        out.push({
          provider: providerKey,
          providerAlias: alias,
          providerName,
          providerColor: providerInfo.color || null,
          id: m.id,
          name: m.name || m.id,
          kind: m.type || "llm",
          fullId,
          input: pricing?.input ?? null,
          output: pricing?.output ?? null,
          cached: pricing?.cached ?? null,
          reasoning: pricing?.reasoning ?? null,
          cacheCreation: pricing?.cache_creation ?? null,
          contextWindow: m.contextWindow ?? null,
          capabilities: m.capabilities ?? null,
          options: m.options ?? null,
          plans: unrestricted ? [] : (plansByModel.get(fullId) || []),
        });
      }
    }

    return NextResponse.json({ models: out, unrestricted });
  } catch (e) {
    console.log("[/api/store/models] error:", e.message);
    return NextResponse.json({ models: [], unrestricted: false }, { status: 500 });
  }
}
