// Centralised API error response helper.
//
// Why: returning `e.message` directly to clients leaks internal details
// (stack traces, file paths, ORM errors). This helper logs the full error
// server-side and returns a generic public message — unless the error is a
// `HttpError` subclass that explicitly opts in to exposing its message.
//
// Usage:
//   try { ... }
//   catch (e) { return apiError(e, "Could not save", 400, "settings/update"); }
//
// Or throw a typed error from validation:
//   throw new BadRequestError("Email is required");
//   → apiError sees `expose=true` and returns the message verbatim.

import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.expose = true;
  }
}

export class BadRequestError extends HttpError {
  constructor(m = "Bad request") {
    super(400, m);
    this.name = "BadRequestError";
  }
}

export class ValidationError extends HttpError {
  constructor(m = "Validation error") {
    super(422, m);
    this.name = "ValidationError";
  }
}

/**
 * Build a sanitised JSON error response. Logs the full error to stderr with
 * an optional context tag and returns either:
 *   - the error's own message (when `e` is a HttpError-like with expose=true)
 *   - the `fallback` string otherwise.
 *
 * @param {Error|unknown} e        Caught error.
 * @param {string} fallback        Public message shown when error is not exposable.
 * @param {number} status          Status code to use for the fallback case.
 * @param {string} ctx             Context tag for the server-side log (e.g. "auth/login").
 */
export function apiError(e, fallback = "Internal error", status = 500, ctx = "") {
  const tag = ctx ? `[${ctx}] ` : "";
  console.error(`${tag}error:`, e?.stack || e?.message || e);
  if (e?.expose && e?.status) {
    return NextResponse.json({ error: e.message || fallback }, { status: e.status });
  }
  return NextResponse.json({ error: fallback }, { status });
}
