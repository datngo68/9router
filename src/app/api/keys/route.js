import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getApiKeyDailyUsageSummary } from "@/lib/usageDb";
import { logKeyAudit } from "@/lib/db/repos/keyAuditRepo.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getClientIp } from "@/lib/auth/loginThrottle";

export const dynamic = "force-dynamic";

function parseAllowedModels(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((m) => typeof m === "string" ? m.trim() : "").filter(Boolean)));
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)));
  }
  return [];
}

function parseAllowedIps(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((m) => typeof m === "string" ? m.trim() : "").filter(Boolean)));
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)));
  }
  return [];
}

function parsePolicy(body) {
  const dailyTokenLimit = body.dailyTokenLimit === "" || body.dailyTokenLimit == null ? 0 : Number(body.dailyTokenLimit);
  if (!Number.isInteger(dailyTokenLimit) || dailyTokenLimit < 0) {
    return { error: "dailyTokenLimit must be a non-negative integer" };
  }

  const monthlyTokenLimit = body.monthlyTokenLimit === "" || body.monthlyTokenLimit == null ? 0 : Number(body.monthlyTokenLimit);
  if (!Number.isInteger(monthlyTokenLimit) || monthlyTokenLimit < 0) {
    return { error: "monthlyTokenLimit must be a non-negative integer" };
  }

  const lifetimeTokenLimit = body.lifetimeTokenLimit === "" || body.lifetimeTokenLimit == null ? 0 : Number(body.lifetimeTokenLimit);
  if (!Number.isInteger(lifetimeTokenLimit) || lifetimeTokenLimit < 0) {
    return { error: "lifetimeTokenLimit must be a non-negative integer" };
  }

  const requestsPerMinute = body.requestsPerMinute === "" || body.requestsPerMinute == null ? 0 : Number(body.requestsPerMinute);
  if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 0) {
    return { error: "requestsPerMinute must be a non-negative integer" };
  }

  const maxTokensPerRequest = body.maxTokensPerRequest === "" || body.maxTokensPerRequest == null ? 0 : Number(body.maxTokensPerRequest);
  if (!Number.isInteger(maxTokensPerRequest) || maxTokensPerRequest < 0) {
    return { error: "maxTokensPerRequest must be a non-negative integer" };
  }

  let expiresAt = null;
  if (body.expiresAt) {
    const date = new Date(body.expiresAt);
    if (Number.isNaN(date.getTime())) return { error: "expiresAt must be a valid date" };
    expiresAt = date.toISOString();
  }

  return {
    policy: {
      dailyTokenLimit,
      monthlyTokenLimit,
      lifetimeTokenLimit,
      requestsPerMinute,
      maxTokensPerRequest,
      expiresAt,
      allowedModels: parseAllowedModels(body.allowedModels),
      allowedIps: parseAllowedIps(body.allowedIps),
    },
  };
}

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    const keysWithUsage = await Promise.all(
      keys.map(async (key) => ({
        ...key,
        usageToday: await getApiKeyDailyUsageSummary(key),
      }))
    );
    return NextResponse.json({ keys: keysWithUsage });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const parsed = parsePolicy(body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, parsed.policy);

    await logKeyAudit({
      keyId: apiKey.id,
      action: "create",
      actorIp: getClientIp(request),
      metadata: { name: apiKey.name, policy: parsed.policy },
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      dailyTokenLimit: apiKey.dailyTokenLimit,
      monthlyTokenLimit: apiKey.monthlyTokenLimit,
      lifetimeTokenLimit: apiKey.lifetimeTokenLimit,
      requestsPerMinute: apiKey.requestsPerMinute,
      maxTokensPerRequest: apiKey.maxTokensPerRequest,
      expiresAt: apiKey.expiresAt,
      allowedModels: apiKey.allowedModels,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
