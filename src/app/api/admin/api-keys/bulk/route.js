import { NextResponse } from "next/server";
import {
  bulkUpdateApiKeys,
  bulkUpdateApiKeysWith,
  bulkDeleteApiKeys,
} from "@/lib/db/repos/apiKeysRepo.js";
import { requireRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = new Set([
  "toggleActive",
  "setCompress",
  "setQuota",
  "setExpiry",
  "setRateLimit",
  "setAllowedModels",
  "setProviderAccess",
  "delete",
]);

function nonNeg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// POST /api/admin/api-keys/bulk
//   body: { ids: string[], action, payload? }
export async function POST(request) {
  const auth = await requireRole(request, "admin", {
    action: "apikey.bulk",
    targetType: "apiKey",
  });
  if (auth.response) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter((v) => typeof v === "string" && v) : [];
  const action = String(body?.action || "");
  const payload = body?.payload || {};

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }

  switch (action) {
    case "toggleActive": {
      const isActive = !!payload.isActive;
      const res = await bulkUpdateApiKeys(ids, { isActive });
      return NextResponse.json({ ...res, action, applied: { isActive } });
    }

    case "setCompress": {
      const patch = {};
      if (payload.rtkMode !== undefined) patch.rtkMode = payload.rtkMode;
      if (payload.cavemanMode !== undefined) patch.cavemanMode = payload.cavemanMode;
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "rtkMode or cavemanMode required" }, { status: 400 });
      }
      const res = await bulkUpdateApiKeys(ids, patch);
      return NextResponse.json({ ...res, action, applied: patch });
    }

    case "setQuota": {
      const mode = payload.mode === "set" ? "set" : "add";
      const fields = ["dailyTokenLimit", "monthlyTokenLimit", "lifetimeTokenLimit"];
      const provided = {};
      for (const f of fields) {
        if (payload[f] !== undefined && payload[f] !== null && payload[f] !== "") {
          const n = nonNeg(payload[f]);
          if (n != null) provided[f] = n;
        }
      }
      if (Object.keys(provided).length === 0) {
        return NextResponse.json({ error: "no quota fields supplied" }, { status: 400 });
      }
      const res = await bulkUpdateApiKeysWith(ids, (existing) => {
        const out = {};
        for (const [f, v] of Object.entries(provided)) {
          out[f] = mode === "set" ? v : (Number(existing[f]) || 0) + v;
        }
        return out;
      });
      return NextResponse.json({ ...res, action, applied: { mode, ...provided } });
    }

    case "setExpiry": {
      // explicit expiresAt overrides; otherwise extend by N days from current
      // expiry (or now if currently null/expired).
      if (Object.prototype.hasOwnProperty.call(payload, "expiresAt")) {
        const res = await bulkUpdateApiKeys(ids, { expiresAt: payload.expiresAt || null });
        return NextResponse.json({ ...res, action, applied: { expiresAt: payload.expiresAt || null } });
      }
      const days = nonNeg(payload.extendDays);
      if (!days || days <= 0) {
        return NextResponse.json({ error: "extendDays > 0 or expiresAt required" }, { status: 400 });
      }
      const res = await bulkUpdateApiKeysWith(ids, (existing) => {
        const baseTime = existing.expiresAt
          ? Math.max(Date.now(), new Date(existing.expiresAt).getTime())
          : Date.now();
        return { expiresAt: new Date(baseTime + days * 86400000).toISOString() };
      });
      return NextResponse.json({ ...res, action, applied: { extendDays: days } });
    }

    case "setRateLimit": {
      const patch = {};
      if (payload.requestsPerMinute !== undefined && payload.requestsPerMinute !== "") {
        const n = nonNeg(payload.requestsPerMinute);
        if (n != null) patch.requestsPerMinute = n;
      }
      if (payload.maxTokensPerRequest !== undefined && payload.maxTokensPerRequest !== "") {
        const n = nonNeg(payload.maxTokensPerRequest);
        if (n != null) patch.maxTokensPerRequest = n;
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "no rate-limit fields supplied" }, { status: 400 });
      }
      const res = await bulkUpdateApiKeys(ids, patch);
      return NextResponse.json({ ...res, action, applied: patch });
    }

    case "setAllowedModels": {
      const list = Array.isArray(payload.allowedModels) ? payload.allowedModels : null;
      if (!list) {
        return NextResponse.json({ error: "allowedModels must be an array" }, { status: 400 });
      }
      const merge = !!payload.merge;
      if (!merge) {
        const res = await bulkUpdateApiKeys(ids, { allowedModels: list });
        return NextResponse.json({ ...res, action, applied: { mode: "set", allowedModels: list } });
      }
      const res = await bulkUpdateApiKeysWith(ids, (existing) => {
        const merged = Array.from(new Set([...(existing.allowedModels || []), ...list]));
        return { allowedModels: merged };
      });
      return NextResponse.json({ ...res, action, applied: { mode: "merge", allowedModels: list } });
    }

    case "setProviderAccess": {
      const mode = payload.mode === "merge" ? "merge" : "set";
      const allowedProviders = Array.isArray(payload.allowedProviders) ? payload.allowedProviders : null;
      const allowedConnectionIds = Array.isArray(payload.allowedConnectionIds) ? payload.allowedConnectionIds : null;
      if (!allowedProviders && !allowedConnectionIds) {
        return NextResponse.json({ error: "allowedProviders or allowedConnectionIds required" }, { status: 400 });
      }
      if (mode === "set") {
        const patch = {};
        if (allowedProviders) patch.allowedProviders = allowedProviders;
        if (allowedConnectionIds) patch.allowedConnectionIds = allowedConnectionIds;
        const res = await bulkUpdateApiKeys(ids, patch);
        return NextResponse.json({ ...res, action, applied: { mode, ...patch } });
      }
      // merge mode
      const res = await bulkUpdateApiKeysWith(ids, (existing) => {
        const out = {};
        if (allowedProviders) {
          out.allowedProviders = Array.from(new Set([...(existing.allowedProviders || []), ...allowedProviders]));
        }
        if (allowedConnectionIds) {
          out.allowedConnectionIds = Array.from(new Set([...(existing.allowedConnectionIds || []), ...allowedConnectionIds]));
        }
        return out;
      });
      return NextResponse.json({ ...res, action, applied: { mode, allowedProviders, allowedConnectionIds } });
    }

    case "delete": {
      const res = await bulkDeleteApiKeys(ids);
      return NextResponse.json({ ...res, action });
    }

    default:
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
}
