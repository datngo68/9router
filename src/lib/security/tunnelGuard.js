// Server-side security checks for tunnel/dashboard exposure.
//
// The dashboard UI shows banners but the API used to accept the destructive
// state (e.g. tunnel ON + requireApiKey OFF). This module centralizes the
// invariants so every code path enforces them.

import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";

/**
 * True when the dashboard password is still the unset/default value.
 * Treats both "no password persisted" and "literal 123456" as default
 * because the login route accepts either.
 */
export async function hasDefaultPassword(settings = null) {
  const s = settings || (await getSettings());
  // No persisted hash → login accepts INITIAL_PASSWORD or "123456".
  if (!s.password) return true;
  return false;
}

/**
 * Returns whether either Cloudflare tunnel or Tailscale funnel is currently
 * intended to be on. Reads the `settingsEnabled` mirrors the watchdog uses.
 */
export function isAnyRemoteAccessEnabled(settings) {
  if (!settings) return false;
  return Boolean(settings.tunnelEnabled || settings.tailscaleEnabled);
}

/**
 * Throw a 4xx-style error object the caller can pass to NextResponse.json.
 * Returns null if the action is allowed.
 */
export async function assertSafeToEnableRemoteAccess() {
  const settings = await getSettings();
  if (await hasDefaultPassword(settings)) {
    return {
      status: 400,
      error: "Set a dashboard password before enabling tunnel/Tailscale. Default password is not allowed for remote access.",
    };
  }
  if (!settings.requireApiKey) {
    return {
      status: 400,
      error: "Enable \"Require API key\" before exposing the endpoint via tunnel/Tailscale.",
    };
  }
  return null;
}

/**
 * Validate a settings PATCH body. Reject patches that would make the
 * currently-exposed endpoint insecure. Returns { error, status } or null.
 */
export async function validateSettingsPatch(patch) {
  const settings = await getSettings();
  const remoteOn = isAnyRemoteAccessEnabled(settings);

  if (remoteOn && Object.prototype.hasOwnProperty.call(patch, "requireApiKey") && patch.requireApiKey === false) {
    return {
      status: 400,
      error: "Cannot disable \"Require API key\" while a tunnel is active. Disable the tunnel first.",
    };
  }
  if (remoteOn && Object.prototype.hasOwnProperty.call(patch, "requireLogin") && patch.requireLogin === false) {
    // Allow only if dashboard access is also blocked (loopback only).
    const tunnelDashboardAccess = Object.prototype.hasOwnProperty.call(patch, "tunnelDashboardAccess")
      ? patch.tunnelDashboardAccess
      : settings.tunnelDashboardAccess;
    if (tunnelDashboardAccess) {
      return {
        status: 400,
        error: "Cannot disable login while tunnel dashboard access is allowed.",
      };
    }
  }
  // Enabling tunnel dashboard access requires login + non-default password.
  if (Object.prototype.hasOwnProperty.call(patch, "tunnelDashboardAccess") && patch.tunnelDashboardAccess === true) {
    if (await hasDefaultPassword(settings)) {
      return {
        status: 400,
        error: "Set a real dashboard password before allowing tunnel dashboard access.",
      };
    }
    if (settings.requireLogin === false) {
      return {
        status: 400,
        error: "Enable \"Require login\" before allowing tunnel dashboard access.",
      };
    }
  }
  return null;
}

export { DEFAULT_PASSWORD };
