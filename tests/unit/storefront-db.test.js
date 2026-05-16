import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-storefront-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}

beforeAll(async () => { await loadFresh(); });

afterAll(() => {
  db?.getAdapterSync?.()?.close?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("storefront DB layer (Phase 1)", () => {
  it("creates a customer with bcrypt-hashed password and dedupes by email", async () => {
    const c = await db.createCustomer({
      email: "  Alice@example.com  ",
      password: "verysecret",
      displayName: "Alice",
    });
    expect(c.id).toBeTruthy();
    expect(c.email).toBe("alice@example.com");
    expect(c.passwordHash).toBeUndefined(); // hash never returned

    await expect(db.createCustomer({ email: "alice@example.com", password: "verysecret" }))
      .rejects.toThrow(/already registered/);

    const found = await db.findCustomerByEmail("ALICE@example.com");
    expect(found?.id).toBe(c.id);
  });

  it("verifyCustomerPassword is case-insensitive on email and rejects bad password", async () => {
    await db.createCustomer({ email: "bob@example.com", password: "passw0rd!" });
    expect(await db.verifyCustomerPassword("bob@example.com", "passw0rd!")).toBeTruthy();
    expect(await db.verifyCustomerPassword("BOB@EXAMPLE.com", "passw0rd!")).toBeTruthy();
    expect(await db.verifyCustomerPassword("bob@example.com", "wrong")).toBeNull();
    expect(await db.verifyCustomerPassword("ghost@example.com", "anything")).toBeNull();
  });

  it("customer sessions hash the token at rest and expire correctly", async () => {
    const cust = await db.createCustomer({ email: "ses@example.com", password: "passw0rd!" });
    const { token, id, expiresAt } = await db.createCustomerSession({ customerId: cust.id });
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Raw token never persisted
    const adapter = db.getAdapterSync();
    const row = adapter.get(`SELECT tokenHash FROM customerSessions WHERE id = ?`, [id]);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(db.hashToken(token));

    const session = await db.findCustomerSessionByToken(token);
    expect(session?.customerId).toBe(cust.id);

    await db.revokeCustomerSession(id);
    expect(await db.findCustomerSessionByToken(token)).toBeNull();
  });

  it("creates pricing plans, lists active only, updates and deletes", async () => {
    const created = await db.createPricingPlan({
      kind: "monthly",
      name: "Pro 1M tokens / month",
      description: "For daily use",
      priceVnd: 200000,
      monthlyTokenLimit: 1_000_000,
      requestsPerMinute: 60,
      maxTokensPerRequest: 8192,
      expiresAfterDays: 30,
      allowedModels: ["openai/gpt-4o", "openai/gpt-4o-mini", "openai/gpt-4o-mini"],
    });
    expect(created.allowedModels).toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"]);

    const inactive = await db.createPricingPlan({ kind: "topup", name: "Hidden", priceVnd: 1, isActive: false });
    const all = await db.getPricingPlans();
    const active = await db.getPricingPlans({ activeOnly: true });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(active.find((p) => p.id === inactive.id)).toBeUndefined();

    const updated = await db.updatePricingPlan(created.id, { priceVnd: 250000 });
    expect(updated.priceVnd).toBe(250000);

    expect(await db.deletePricingPlan(inactive.id)).toBe(true);
  });

  it("planToApiKeyPolicy maps fields and computes expiresAt from expiresAfterDays", async () => {
    const plan = await db.createPricingPlan({
      kind: "topup",
      name: "Pack 100k",
      priceVnd: 50000,
      lifetimeTokenLimit: 100_000,
      expiresAfterDays: 90,
    });
    const policy = db.planToApiKeyPolicy(plan);
    expect(policy.lifetimeTokenLimit).toBe(100_000);
    const expectedExpiry = Date.now() + 90 * 86400000;
    expect(new Date(policy.expiresAt).getTime()).toBeGreaterThan(expectedExpiry - 5000);
    expect(new Date(policy.expiresAt).getTime()).toBeLessThan(expectedExpiry + 5000);
  });

  it("confirmOrderAtomic creates an apiKey scoped to the customer and order", async () => {
    const cust = await db.createCustomer({ email: "buy@example.com", password: "verysecret" });
    const plan = await db.createPricingPlan({
      kind: "monthly",
      name: "Plan A",
      priceVnd: 100000,
      dailyTokenLimit: 50_000,
      monthlyTokenLimit: 1_000_000,
      requestsPerMinute: 30,
      maxTokensPerRequest: 4096,
      allowedModels: ["openai/gpt-4o-mini"],
    });

    const order = await db.createOrder({ customerId: cust.id, planId: plan.id, paymentMethod: "bank" });
    expect(order.status).toBe("pending");
    expect(order.id.startsWith("9R-")).toBe(true);

    const result = await db.confirmOrderAtomic({
      orderId: order.id,
      paymentRef: "TX-123",
      machineId: "test-machine-storefront",
      actorIp: "1.1.1.1",
    });

    expect(result.order.status).toBe("delivered");
    expect(result.order.apiKeyId).toBe(result.apiKey.id);
    expect(result.apiKey.key).toMatch(/^sk_/);

    const keys = await db.getApiKeysByCustomer(cust.id);
    expect(keys).toHaveLength(1);
    expect(keys[0].id).toBe(result.apiKey.id);
    expect(keys[0].dailyTokenLimit).toBe(50_000);
    expect(keys[0].allowedModels).toEqual(["openai/gpt-4o-mini"]);
    expect(keys[0].customerId).toBe(cust.id);
    expect(keys[0].orderId).toBe(order.id);

    // Audit log entry exists
    const audit = await db.getKeyAuditLog({ keyId: result.apiKey.id });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].action).toBe("create-from-order");
    expect(audit[0].metadata.orderId).toBe(order.id);
  });

  it("confirmOrderAtomic is idempotent on already-delivered orders", async () => {
    const cust = await db.createCustomer({ email: "idem@example.com", password: "verysecret" });
    const plan = await db.createPricingPlan({ kind: "topup", name: "Idem Plan", priceVnd: 1, lifetimeTokenLimit: 100 });
    const order = await db.createOrder({ customerId: cust.id, planId: plan.id });
    await db.confirmOrderAtomic({ orderId: order.id, machineId: "m" });
    const second = await db.confirmOrderAtomic({ orderId: order.id, machineId: "m" });
    expect(second.apiKey.alreadyDelivered).toBe(true);
    expect(second.apiKey.key).toBeNull();
    const keys = await db.getApiKeysByCustomer(cust.id);
    expect(keys).toHaveLength(1); // not duplicated
  });

  it("cancelOrder only works on pending orders", async () => {
    const cust = await db.createCustomer({ email: "cancel@example.com", password: "verysecret" });
    const plan = await db.createPricingPlan({ kind: "topup", name: "Cancel Plan", priceVnd: 1 });
    const order = await db.createOrder({ customerId: cust.id, planId: plan.id });
    const cancelled = await db.cancelOrder(order.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(db.cancelOrder(order.id)).rejects.toThrow(/cancelled/);
  });
});
