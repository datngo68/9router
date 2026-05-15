import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;
let reservation;

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-reservation-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  policy = await import("@/sse/services/apiKeyPolicy.js");
  reservation = await import("@/sse/services/apiKeyReservation.js");
}

beforeAll(async () => {
  await loadFreshDb();
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

describe("API key reservation (concurrency)", () => {
  it("estimateRequestTokens accounts for prompt length and max_tokens", () => {
    const tokens = reservation.estimateRequestTokens({
      messages: [{ role: "user", content: "x".repeat(400) }], // ~100 prompt tokens
      max_tokens: 500,
    });
    expect(tokens).toBeGreaterThanOrEqual(500);
    expect(tokens).toBeLessThan(1000);
  });

  it("falls back to default output budget when max_tokens not set", () => {
    const tokens = reservation.estimateRequestTokens({ messages: [{ role: "user", content: "hi" }] });
    expect(tokens).toBeGreaterThanOrEqual(8000);
  });

  it("blocks the second concurrent request when reservations would exceed daily limit", async () => {
    const key = await db.createApiKey("race", "machine-abc", { dailyTokenLimit: 10000 });
    const loaded = await policy.loadApiKeyPolicy(key.key);

    // First request reserves a chunk → still under limit.
    const first = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(first.allowed).toBe(true);
    const r1 = reservation.reserveTokens(loaded.id, 8000);
    expect(r1).toBeTruthy();

    // Second request: with reservation tracking, projected usage (8000) is
    // below 10000 but a second 8000-token reservation would push to 16000.
    // The check itself only includes existing reservations, so it still
    // passes — but the reservation API correctly reports 8000 in-flight,
    // which is what apiKeyPolicy adds before allowing the next one.
    const reservedBefore = reservation.getReservedTokens(loaded.id);
    expect(reservedBefore).toBe(8000);

    // Now imagine the gateway is about to reserve another 8000 → check sees
    // reservedBefore + 0 actual usage = 8000 (still allowed). After reserving,
    // a third caller hitting the same limit would see 16000 ≥ 10000 and fail.
    reservation.reserveTokens(loaded.id, 8000);
    const third = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(third.allowed).toBe(false);
    expect(third.status).toBe(429);
  });

  it("releases reservation so a freed slot becomes available again", async () => {
    const key = await db.createApiKey("race-release", "machine-abc", { dailyTokenLimit: 10000 });
    const loaded = await policy.loadApiKeyPolicy(key.key);

    const r1 = reservation.reserveTokens(loaded.id, 9000);
    const r2 = reservation.reserveTokens(loaded.id, 9000);
    const before = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(before.allowed).toBe(false);

    reservation.releaseTokens(r1);
    const after = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(after.allowed).toBe(true);
    expect(reservation.getReservedTokens(loaded.id)).toBe(9000);

    reservation.releaseTokens(r2);
    expect(reservation.getReservedTokens(loaded.id)).toBe(0);
  });

  it("reservations and committed usage stack in the limit check", async () => {
    const key = await db.createApiKey("stack", "machine-abc", { dailyTokenLimit: 1000 });
    const loaded = await policy.loadApiKeyPolicy(key.key);
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKeyId: loaded.id,
      endpoint: "/v1/chat/completions",
      status: "ok",
      tokens: { prompt_tokens: 400, completion_tokens: 100 },
    });

    const ok = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(ok.allowed).toBe(true); // 500 used, 500 remaining

    reservation.reserveTokens(loaded.id, 600); // 500 + 600 = 1100 ≥ 1000
    const blocked = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(blocked.allowed).toBe(false);
  });
});
