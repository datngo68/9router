import { SignJWT, jwtVerify } from "jose";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { writeSecretFile, tightenFileMode } from "@/lib/security/filePerms";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    tightenFileMode(file);
    return value;
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  writeSecretFile(file, generated);
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

async function currentTokenVersion() {
  try {
    const settings = await getSettings();
    return Number(settings?.tokenVersion || 0);
  } catch {
    return 0;
  }
}

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  const v = await currentTokenVersion();
  // Default role: "admin" — the dashboard token currently represents a single
  // admin operator. The role claim is here so future code paths can require
  // specific roles without forcing a token-version bump.
  return new SignJWT({ authenticated: true, v, role: "admin", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const v = await currentTokenVersion();
    // Tokens minted before the current version are revoked. Treat missing
    // payload.v as 0 so legacy tokens minted pre-Phase-2.3 still verify until
    // the operator bumps the version (e.g. by changing password).
    if (Number(payload.v ?? 0) !== v) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const v = await currentTokenVersion();
    if (Number(payload.v ?? 0) !== v) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

/**
 * Bump the global token version so all currently-issued JWTs become invalid.
 * Caller must persist a fresh cookie afterward (e.g. login response).
 */
export async function revokeAllDashboardSessions() {
  const { updateSettings } = await import("@/lib/localDb");
  const settings = await getSettings();
  const next = Number(settings?.tokenVersion || 0) + 1;
  await updateSettings({ tokenVersion: next });
  return next;
}
