import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;
let reservation;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-monthly-lifetime-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  policy = await import("@/sse/services/apiKeyPolicy.js");
  reservation = await import("@/sse/services/apiKeyReservation.js");
}

beforeAll(async () => {
  await loadFresh();
});

beforeEach(() => {
  reservation._resetReservations();
});

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("monthly + lifetime token caps (Phase 3.1)", () => {
  it("monthlyTokenLimit blocks once usage hits the cap", async () => {
    const created = await db.createApiKey("monthly", "machine-m1", { monthlyTokenLimit: 1000 });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKeyId: created.id,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 600, completion_tokens: 400 },
    });

    const loaded = await policy.loadApiKeyPolicy(created.key);
    const result = await policy.checkApiKeyMonthlyTokenLimit(loaded);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(429);
    expect(result.usage.totalTokens).toBe(1000);
  });

  it("lifetimeTokenLimit blocks across all-time usage", async () => {
    const created = await db.createApiKey("lifetime", "machine-l1", { lifetimeTokenLimit: 500 });
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKeyId: created.id,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 300, completion_tokens: 250 },
    });

    const loaded = await policy.loadApiKeyPolicy(created.key);
    const r = await policy.checkApiKeyLifetimeTokenLimit(loaded);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
    expect(r.usage.totalTokens).toBe(550);
  });

  it("limits at 0 are treated as unlimited", async () => {
    const created = await db.createApiKey("unlimited", "machine-u1", { monthlyTokenLimit: 0, lifetimeTokenLimit: 0 });
    const loaded = await policy.loadApiKeyPolicy(created.key);

    expect((await policy.checkApiKeyMonthlyTokenLimit(loaded)).allowed).toBe(true);
    expect((await policy.checkApiKeyLifetimeTokenLimit(loaded)).allowed).toBe(true);
  });

  it("reservations stack with committed usage for monthly cap", async () => {
    const created = await db.createApiKey("month-reserve", "machine-m2", { monthlyTokenLimit: 1000 });
    const loaded = await policy.loadApiKeyPolicy(created.key);
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKeyId: created.id,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 400, completion_tokens: 100 },
    });

    expect((await policy.checkApiKeyMonthlyTokenLimit(loaded)).allowed).toBe(true);
    reservation.reserveTokens(loaded.id, 600);
    const blocked = await policy.checkApiKeyMonthlyTokenLimit(loaded);
    expect(blocked.allowed).toBe(false);
  });
});
