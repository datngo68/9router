// End-to-end smoke for the storefront flow at the DB+policy level.
//
// We exercise everything that doesn't require Next.js HTTP routing:
//   1. Customer registers (via repo)
//   2. Admin creates a pricing plan
//   3. Customer creates an order
//   4. Admin confirms → key is generated, audit logged, order delivered
//   5. The new key carries the policy from the plan
//   6. Calling the chat handler with that key respects daily/monthly/lifetime
//      caps (we just verify checkApiKey* policy paths since chat handler
//      requires upstream HTTP mocks).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;
let reservation;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-storefront-smoke-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  policy = await import("@/sse/services/apiKeyPolicy.js");
  reservation = await import("@/sse/services/apiKeyReservation.js");
}

beforeAll(async () => { await loadFresh(); });

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("storefront end-to-end smoke", () => {
  it("register → plan → order → confirm → key works end-to-end", async () => {
    // 1) Customer
    const customer = await db.createCustomer({
      email: "smoke@example.com",
      password: "verysecret",
      displayName: "Smoke Buyer",
      telegramChatId: "1234",
    });
    expect(customer.id).toBeTruthy();

    // 2) Admin creates a Pro Monthly plan
    const plan = await db.createPricingPlan({
      kind: "monthly",
      name: "Pro 100k tokens / day",
      priceVnd: 200000,
      dailyTokenLimit: 100_000,
      monthlyTokenLimit: 1_000_000,
      requestsPerMinute: 60,
      maxTokensPerRequest: 8192,
      expiresAfterDays: 30,
      allowedModels: ["openai/gpt-4o-mini"],
    });

    // 3) Customer creates an order
    const order = await db.createOrder({ customerId: customer.id, planId: plan.id, paymentMethod: "bank" });
    expect(order.status).toBe("pending");
    expect(order.priceVnd).toBe(200000);

    // 4) Admin confirms — key is generated, order delivered
    const confirmation = await db.confirmOrderAtomic({
      orderId: order.id,
      paymentRef: "VCB-FT-9999",
      machineId: "smoke-machine",
      actorIp: "1.2.3.4",
    });
    expect(confirmation.order.status).toBe("delivered");
    expect(confirmation.apiKey.key).toMatch(/^sk_/);

    // 5) Plan policy mirrored onto the apiKey
    const keys = await db.getApiKeysByCustomer(customer.id);
    expect(keys).toHaveLength(1);
    const k = keys[0];
    expect(k.dailyTokenLimit).toBe(100_000);
    expect(k.monthlyTokenLimit).toBe(1_000_000);
    expect(k.requestsPerMinute).toBe(60);
    expect(k.maxTokensPerRequest).toBe(8192);
    expect(k.allowedModels).toEqual(["openai/gpt-4o-mini"]);
    expect(k.customerId).toBe(customer.id);
    expect(k.orderId).toBe(order.id);
    expect(k.expiresAt).toBeTruthy();

    // 6) Audit trail recorded
    const audit = await db.getKeyAuditLog({ keyId: k.id });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].action).toBe("create-from-order");
    expect(audit[0].metadata.orderId).toBe(order.id);

    // 7) Policy gates the new key
    const loaded = await policy.loadApiKeyPolicy(confirmation.apiKey.key);
    expect(loaded.id).toBe(k.id);

    // a) Allowed model passes
    const passOk = policy.checkApiKeyModelAccess(loaded, {
      requestedModel: "openai/gpt-4o-mini",
      resolvedModels: ["openai/gpt-4o-mini"],
    });
    expect(passOk.allowed).toBe(true);

    // b) Disallowed model is blocked
    const blocked = policy.checkApiKeyModelAccess(loaded, {
      requestedModel: "anthropic/claude-sonnet-4.5",
      resolvedModels: ["anthropic/claude-sonnet-4.5"],
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.status).toBe(403);

    // c) Daily cap not yet hit
    const daily = await policy.checkApiKeyDailyTokenLimit(loaded);
    expect(daily.allowed).toBe(true);

    // d) max_tokens cap honored
    const tooMany = policy.checkApiKeyMaxTokensPerRequest(loaded, { max_tokens: 9999 });
    expect(tooMany.allowed).toBe(false);

    // 8) Idempotent confirm doesn't duplicate keys
    const second = await db.confirmOrderAtomic({ orderId: order.id, machineId: "smoke-machine" });
    expect(second.apiKey.alreadyDelivered).toBe(true);
    const keysAfterDouble = await db.getApiKeysByCustomer(customer.id);
    expect(keysAfterDouble).toHaveLength(1);
  });

  it("portal access control: another customer cannot see foreign keys", async () => {
    // alice is the original buyer from the smoke test above. Create bob
    // with no purchases.
    const bob = await db.createCustomer({ email: "bob@example.com", password: "verysecret" });
    const aliceKeys = await db.getApiKeysByCustomer(
      (await db.findCustomerByEmail("smoke@example.com")).id
    );
    const bobKeys = await db.getApiKeysByCustomer(bob.id);
    expect(aliceKeys.length).toBe(1);
    expect(bobKeys.length).toBe(0);
  });
});
