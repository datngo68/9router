// Pricing plans repo. Plans are templates that get copied into apiKey policy
// when an order is fulfilled.

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const VALID_KINDS = new Set(["monthly", "topup"]);

function normalizeNonNegativeInt(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeAllowedModels(value) {
  const list = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean)));
}

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description || "",
    priceVnd: normalizeNonNegativeInt(row.priceVnd),
    dailyTokenLimit: normalizeNonNegativeInt(row.dailyTokenLimit),
    monthlyTokenLimit: normalizeNonNegativeInt(row.monthlyTokenLimit),
    lifetimeTokenLimit: normalizeNonNegativeInt(row.lifetimeTokenLimit),
    requestsPerMinute: normalizeNonNegativeInt(row.requestsPerMinute),
    maxTokensPerRequest: normalizeNonNegativeInt(row.maxTokensPerRequest),
    expiresAfterDays: normalizeNonNegativeInt(row.expiresAfterDays),
    allowedModels: normalizeAllowedModels(row.allowedModels),
    isActive: row.isActive === 1 || row.isActive === true,
    sortOrder: normalizeNonNegativeInt(row.sortOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validate(input) {
  if (!input.name) throw new Error("name is required");
  if (!VALID_KINDS.has(input.kind)) throw new Error(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
}

export async function getPricingPlans({ activeOnly = false } = {}) {
  const db = await getAdapter();
  const where = activeOnly ? "WHERE isActive = 1" : "";
  return db.all(`SELECT * FROM pricingPlans ${where} ORDER BY sortOrder ASC, createdAt ASC`).map(rowToPlan);
}

export async function getPricingPlanById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToPlan(db.get(`SELECT * FROM pricingPlans WHERE id = ?`, [id]));
}

export async function createPricingPlan(input) {
  validate(input);
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO pricingPlans(id, kind, name, description, priceVnd, dailyTokenLimit, monthlyTokenLimit, lifetimeTokenLimit, requestsPerMinute, maxTokensPerRequest, expiresAfterDays, allowedModels, isActive, sortOrder, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.kind,
      input.name,
      input.description || null,
      normalizeNonNegativeInt(input.priceVnd),
      normalizeNonNegativeInt(input.dailyTokenLimit),
      normalizeNonNegativeInt(input.monthlyTokenLimit),
      normalizeNonNegativeInt(input.lifetimeTokenLimit),
      normalizeNonNegativeInt(input.requestsPerMinute),
      normalizeNonNegativeInt(input.maxTokensPerRequest),
      normalizeNonNegativeInt(input.expiresAfterDays),
      stringifyJson(normalizeAllowedModels(input.allowedModels)),
      input.isActive === false ? 0 : 1,
      normalizeNonNegativeInt(input.sortOrder),
      now,
      now,
    ]
  );
  return getPricingPlanById(id);
}

export async function updatePricingPlan(id, patch) {
  const db = await getAdapter();
  const existing = await getPricingPlanById(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "kind")) validate({ name: merged.name, kind: merged.kind });

  const now = new Date().toISOString();
  db.run(
    `UPDATE pricingPlans SET kind = ?, name = ?, description = ?, priceVnd = ?, dailyTokenLimit = ?, monthlyTokenLimit = ?, lifetimeTokenLimit = ?, requestsPerMinute = ?, maxTokensPerRequest = ?, expiresAfterDays = ?, allowedModels = ?, isActive = ?, sortOrder = ?, updatedAt = ? WHERE id = ?`,
    [
      merged.kind,
      merged.name,
      merged.description || null,
      normalizeNonNegativeInt(merged.priceVnd),
      normalizeNonNegativeInt(merged.dailyTokenLimit),
      normalizeNonNegativeInt(merged.monthlyTokenLimit),
      normalizeNonNegativeInt(merged.lifetimeTokenLimit),
      normalizeNonNegativeInt(merged.requestsPerMinute),
      normalizeNonNegativeInt(merged.maxTokensPerRequest),
      normalizeNonNegativeInt(merged.expiresAfterDays),
      stringifyJson(normalizeAllowedModels(merged.allowedModels)),
      merged.isActive === false ? 0 : 1,
      normalizeNonNegativeInt(merged.sortOrder),
      now,
      id,
    ]
  );
  return getPricingPlanById(id);
}

export async function deletePricingPlan(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM pricingPlans WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Project a pricingPlan into the policy fields used when creating an apiKey.
 */
export function planToApiKeyPolicy(plan) {
  if (!plan) return {};
  const expiresAt = plan.expiresAfterDays > 0
    ? new Date(Date.now() + plan.expiresAfterDays * 86400000).toISOString()
    : null;
  return {
    dailyTokenLimit: plan.dailyTokenLimit,
    monthlyTokenLimit: plan.monthlyTokenLimit,
    lifetimeTokenLimit: plan.lifetimeTokenLimit,
    requestsPerMinute: plan.requestsPerMinute,
    maxTokensPerRequest: plan.maxTokensPerRequest,
    expiresAt,
    allowedModels: plan.allowedModels,
  };
}
