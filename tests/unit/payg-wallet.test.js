// PAYG wallet — hot-path charging, idempotent top-up, manual adjust.
//
// Uses a fresh DATA_DIR per test file so migrations run on an empty SQLite
// file. All flows go through the public DB layer (no internal poking).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let walletRepo;
let paygRepo;
let usageRepo;

async function loadFresh() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-payg-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  walletRepo = await import("@/lib/db/repos/walletRepo.js");
  paygRepo = await import("@/lib/db/repos/paygPricingRepo.js");
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
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

async function makeCustomer(email = "payg@example.com") {
  return db.createCustomer({ email, password: "passw0rd!" });
}

async function makePlan() {
  return db.createPricingPlan({
    kind: "monthly",
    name: "Test Plan",
    priceVnd: 100000,
    dailyTokenLimit: 1000,
    monthlyTokenLimit: 0,
    lifetimeTokenLimit: 0,
    requestsPerMinute: 0,
    maxTokensPerRequest: 0,
    expiresAfterDays: 30,
    allowedModels: [],
    isActive: true,
  });
}

describe("walletRepo", () => {
  it("vndToMicro/microToVnd round-trip", () => {
    expect(walletRepo.vndToMicro(1234)).toBe(1234 * 1_000_000);
    expect(walletRepo.microToVnd(1234 * 1_000_000)).toBe(1234);
  });

  it("applyWalletDelta credits and debits, ledger captures balanceAfter", async () => {
    const c = await makeCustomer("ledger@example.com");
    const credit = await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: walletRepo.vndToMicro(50000),
      type: "topup",
    });
    expect(credit.balanceAfter).toBe(walletRepo.vndToMicro(50000));

    const debit = await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: -walletRepo.vndToMicro(10000),
      type: "charge",
    });
    expect(debit.balanceAfter).toBe(walletRepo.vndToMicro(40000));

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(40000));

    const ledger = await walletRepo.listWalletTransactions(c.id);
    expect(ledger.total).toBe(2);
    expect(ledger.items[0].type).toBe("charge"); // newest first
    expect(ledger.items[1].type).toBe("topup");
  });

  it("setBalanceMinLimit accepts negative values for overdraft", async () => {
    const c = await makeCustomer("overdraft@example.com");
    await walletRepo.setBalanceMinLimit(c.id, -walletRepo.vndToMicro(5000));
    const b = await walletRepo.getWalletBalance(c.id);
    expect(b.balanceMinLimit).toBe(-walletRepo.vndToMicro(5000));
  });
});

describe("paygPricingRepo", () => {
  it("returns null when no pricing configured", async () => {
    paygRepo._invalidatePaygPricingCache();
    const p = await paygRepo.getPaygPricingForModel("openai", "missing-model");
    expect(p).toBeNull();
  });

  it("exact provider|model and pattern lookups", async () => {
    await paygRepo.updatePaygPricing({
      "openai|gpt-5": { inputVnd: 100000, outputVnd: 400000 },
      "pattern:claude-opus-*": { inputVnd: 150000, outputVnd: 600000 },
    });
    paygRepo._invalidatePaygPricingCache();

    const exact = await paygRepo.getPaygPricingForModel("openai", "gpt-5");
    expect(exact?.inputVnd).toBe(100000);

    const pattern = await paygRepo.getPaygPricingForModel("anthropic", "claude-opus-4-5");
    expect(pattern?.outputVnd).toBe(600000);
  });

  it("calculatePaygCostMicroVnd sums every token bucket correctly", async () => {
    await paygRepo.updatePaygPricing({
      "openai|gpt-5": { inputVnd: 100000, outputVnd: 400000 },
    });
    paygRepo._invalidatePaygPricingCache();

    // 1M input + 1M output tokens → 100k + 400k = 500k VND = 500B micro
    const r = await paygRepo.calculatePaygCostMicroVnd({
      provider: "openai",
      model: "gpt-5",
      tokens: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    });
    expect(r.microVnd).toBe(500_000 * 1_000_000);
  });

  it("min charge floor applies when usage > 0 but cost is tiny", async () => {
    await paygRepo.updatePaygPricing({
      "openai|gpt-5": { inputVnd: 1, outputVnd: 1 },
    });
    paygRepo._invalidatePaygPricingCache();

    // 1 token at 1 VND/1M → 1 micro-VND, but min charge 10 VND should bump.
    const r = await paygRepo.calculatePaygCostMicroVnd({
      provider: "openai",
      model: "gpt-5",
      tokens: { prompt_tokens: 1 },
      minChargeVnd: 10,
    });
    expect(r.microVnd).toBe(10 * 1_000_000);
  });
});

describe("saveRequestUsage with chargeFromWallet", () => {
  it("debits wallet and writes ledger inside same transaction", async () => {
    const c = await makeCustomer("charge@example.com");
    await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: walletRepo.vndToMicro(100000),
      type: "topup",
    });

    await paygRepo.updatePaygPricing({
      "openai|gpt-5": { inputVnd: 100000, outputVnd: 400000 },
    });
    paygRepo._invalidatePaygPricingCache();

    await usageRepo.saveRequestUsage({
      provider: "openai",
      model: "gpt-5",
      apiKeyId: "test-key",
      customerId: c.id,
      chargeFromWallet: true,
      tokens: { prompt_tokens: 100_000, completion_tokens: 50_000 }, // 10k + 20k = 30k VND
      status: "ok",
      endpoint: "/v1/chat/completions",
    });

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(100000 - 30000));

    const ledger = await walletRepo.listWalletTransactions(c.id);
    const charge = ledger.items.find((t) => t.type === "charge");
    expect(charge).toBeTruthy();
    expect(charge.delta).toBe(-walletRepo.vndToMicro(30000));
    expect(charge.model).toBe("gpt-5");
  });

  it("skips wallet debit when chargeFromWallet is false (plan quota path)", async () => {
    const c = await makeCustomer("planpath@example.com");
    await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: walletRepo.vndToMicro(100000),
      type: "topup",
    });

    await usageRepo.saveRequestUsage({
      provider: "openai",
      model: "gpt-5",
      apiKeyId: "key2",
      customerId: c.id,
      chargeFromWallet: false,
      tokens: { prompt_tokens: 1000, completion_tokens: 500 },
      status: "ok",
    });

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(100000));
  });

  it("noops gracefully when PAYG pricing is missing for the model", async () => {
    const c = await makeCustomer("nopricing@example.com");
    await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: walletRepo.vndToMicro(100000),
      type: "topup",
    });

    await paygRepo.resetAllPaygPricing();
    paygRepo._invalidatePaygPricingCache();

    await usageRepo.saveRequestUsage({
      provider: "ghost",
      model: "ghost-model",
      apiKeyId: "key3",
      customerId: c.id,
      chargeFromWallet: true,
      tokens: { prompt_tokens: 1000 },
      status: "ok",
    });

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(100000));
  });
});

describe("topup order flow", () => {
  it("createTopupOrder + confirmOrderAtomic credits wallet, idempotent on replay", async () => {
    const c = await makeCustomer("topup@example.com");
    const order = await db.createTopupOrder({ customerId: c.id, amountVnd: 200000 });
    expect(order.kind).toBe("walletTopup");
    expect(order.planId).toBeNull();
    expect(order.priceVnd).toBe(200000);

    const r1 = await db.confirmOrderAtomic({ orderId: order.id, paymentRef: "TX1" });
    expect(r1.walletTopup?.amountVnd).toBe(200000);
    expect(r1.order.status).toBe("delivered");

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(200000));

    // Replay: should be idempotent (no double credit).
    const r2 = await db.confirmOrderAtomic({ orderId: order.id, paymentRef: "TX1" });
    expect(r2.walletTopup?.alreadyDelivered).toBe(true);

    const balanceAfter = await walletRepo.getWalletBalance(c.id);
    expect(balanceAfter.balance).toBe(walletRepo.vndToMicro(200000));
  });
});

describe("concurrent debit consistency", () => {
  it("N parallel debits sum to the expected total without races", async () => {
    const c = await makeCustomer("concurrent@example.com");
    await walletRepo.applyWalletDelta({
      customerId: c.id,
      delta: walletRepo.vndToMicro(100000),
      type: "topup",
    });

    await paygRepo.updatePaygPricing({
      "openai|gpt-5": { inputVnd: 100000, outputVnd: 400000 },
    });
    paygRepo._invalidatePaygPricingCache();

    const N = 10;
    const tasks = Array.from({ length: N }, (_, i) =>
      usageRepo.saveRequestUsage({
        provider: "openai",
        model: "gpt-5",
        apiKeyId: `concurrent-${i}`,
        customerId: c.id,
        chargeFromWallet: true,
        tokens: { prompt_tokens: 10_000 }, // 1000 VND each
        status: "ok",
      })
    );
    await Promise.all(tasks);

    const balance = await walletRepo.getWalletBalance(c.id);
    expect(balance.balance).toBe(walletRepo.vndToMicro(100000 - N * 1000));

    const ledger = await walletRepo.listWalletTransactions(c.id);
    const charges = ledger.items.filter((t) => t.type === "charge");
    expect(charges).toHaveLength(N);
    const sum = charges.reduce((acc, t) => acc + t.delta, 0);
    expect(sum).toBe(-walletRepo.vndToMicro(N * 1000));
  });
});
