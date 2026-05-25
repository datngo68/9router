// Schemas + helper for validating route inputs with zod.
//
// Use parseJsonBody(request, schema) inside a route to get a typed value or
// a NextResponse with 400 already prepared. Keep schemas small and reusable;
// don't try to capture every field — only what the route uses.

import { z } from "zod";
import { NextResponse } from "next/server";

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export const Email = z.string().trim().toLowerCase().email().max(254);
export const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
export const TotpCode = z.string().regex(/^\d{6}$/);

export const RegisterSchema = z.object({
  email: Email,
  password: Password,
  displayName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  telegramChatId: z.string().trim().max(64).optional(),
});

export const CustomerLoginSchema = z.object({
  email: Email,
  password: z.string().min(1).max(PASSWORD_MAX),
  totpCode: TotpCode.optional(),
});

export const AdminLoginSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const CustomerPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: Password,
});

export const CustomerForgotSchema = z.object({
  email: Email,
});

export const CustomerResetSchema = z.object({
  token: z.string().min(10).max(2000),
  password: Password,
});

export const TotpDisableSchema = z.object({
  code: TotpCode,
});

const AdminOrderActionSchema = z.object({
  action: z.enum(["confirm", "cancel", "refund", "apibank-reconcile"]),
  paymentRef: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const AdminOrderPatchSchema = AdminOrderActionSchema;

export const AdminPricingPlanSchema = z.object({
  kind: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priceVnd: z.number().int().min(0),
  dailyTokenLimit: z.number().int().min(0).optional(),
  monthlyTokenLimit: z.number().int().min(0).optional(),
  lifetimeTokenLimit: z.number().int().min(0).optional(),
  requestsPerMinute: z.number().int().min(0).optional(),
  maxTokensPerRequest: z.number().int().min(0).optional(),
  rateLimitWindowSec: z.number().int().min(0).optional(),
  expiresAfterDays: z.number().int().min(0).optional(),
  expiresAfterMinutes: z.number().int().min(0).optional(),
  allowedModels: z.array(z.string()).optional(),
  maxPurchasesPerCustomer: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const AdminPricingPlanPatchSchema = AdminPricingPlanSchema.partial();

/**
 * Read JSON body and validate against schema.
 * Returns { value } on success or { response } pre-built on failure.
 */
export async function parseJsonBody(request, schema) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return { response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const path = Array.isArray(issue?.path) ? issue.path.join(".") : "";
    const msg = path ? `${path}: ${issue?.message || "invalid"}` : (issue?.message || "Validation failed");
    return { response: NextResponse.json({ error: msg }, { status: 400 }) };
  }
  return { value: result.data };
}
