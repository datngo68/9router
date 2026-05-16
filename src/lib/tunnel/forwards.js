// Multi-tunnel manager — port forwarding entries.
// Each entry exposes a local target (port or host:port) on a stable
// https://r<shortId>.abc-tunnel.us URL. Independent from the dashboard tunnel.
//
// Storage:
//   <DATA_DIR>/tunnel/forwards.json     ← list of entries (persisted)
//   <DATA_DIR>/tunnel/forwards-pids/    ← one .pid file per entry
//
// In-memory:
//   childProcs: Map<id, ChildProcess>   ← live cloudflared processes
//   activeUrls: Map<id, tunnelUrl>      ← last known random *.trycloudflare.com
//   lastRestartAt: Map<id, number>      ← cooldown gate for watchdog
//   missCounts:   Map<id, number>       ← consecutive unreachable probes

import crypto from "crypto";
import {
  loadForwards, saveForwards, generateShortId,
  saveForwardPid, loadForwardPid, clearForwardPid,
} from "./state.js";
import {
  spawnIsolatedQuickTunnel, killIsolatedTunnel, isPidAlive,
} from "./cloudflared.js";
import { probeUrlAlive, checkInternet } from "./networkProbe.js";

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";

// Watchdog tuning
const FORWARD_RESTART_COOLDOWN_MS = 60000;   // min gap between auto-restart attempts per forward
const FORWARD_MISS_THRESHOLD = 2;             // consecutive failed probes before restart
const REGISTER_RETRY_BACKOFF_MS = [500, 1500, 4000];
const ON_EXIT_RESPAWN_DELAY_MS = 3000;        // debounce for crash → respawn

const childProcs = new Map();   // id -> child process
const activeUrls = new Map();   // id -> last tunnelUrl
const inFlight = new Map();     // id -> Promise (guards concurrent enable)
const lastRestartAt = new Map(); // id -> ts of last auto-restart attempt
const missCounts = new Map();    // id -> consecutive miss count
const disabling = new Set();    // ids currently being torn down by user → onExit must skip respawn

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function findById(forwards, id) {
  return forwards.find((f) => f.id === id) || null;
}

function persist(updater) {
  const list = loadForwards();
  updater(list);
  saveForwards(list);
  return list;
}

async function registerWithWorker(shortId, tunnelUrl) {
  // Retry with backoff so a transient worker hiccup doesn't leave a stale
  // mapping (which surfaces as Cloudflare Error 1016 to end users).
  let lastErr = null;
  for (let i = 0; i < REGISTER_RETRY_BACKOFF_MS.length; i++) {
    try {
      const res = await fetch(`${WORKER_URL}/api/tunnel/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId, tunnelUrl }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return true;
      lastErr = new Error(`status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, REGISTER_RETRY_BACKOFF_MS[i]));
  }
  console.warn(`[Forward] worker register failed (${shortId}): ${lastErr?.message || "unknown"}`);
  return false;
}

function publicUrlFor(entry) {
  return `https://${getEffectiveSubdomain(entry)}.abc-tunnel.us`;
}

// Public-facing subdomain used in the URL.
// Random entries: legacy "r<shortId>" prefix.
// Custom entries: exact value the user entered.
function getEffectiveSubdomain(entry) {
  return entry.customSubdomain || `r${entry.shortId}`;
}

// Key used when registering with the worker.
// The worker strips the leading "r" before lookup for random entries,
// so we must register the RAW shortId (matching tunnelManager.js behavior).
// Custom subdomains are registered as-is.
function getWorkerKey(entry) {
  return entry.customSubdomain || entry.shortId;
}

// Loose validation: 3-32 chars, [a-z0-9-], no leading/trailing hyphen.
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

function validateCustomSubdomain(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(s)) {
    throw new Error("Subdomain must be 3-32 chars: a-z, 0-9, hyphen (no leading/trailing hyphen)");
  }
  return s;
}

function isSubdomainTakenLocally(list, subdomain, excludeId) {
  return list.some((f) => f.id !== excludeId && getEffectiveSubdomain(f) === subdomain);
}

function validateTarget(target) {
  const s = String(target || "").trim();
  if (!s) throw new Error("Target is required (e.g. 7000 or 192.168.1.50:7000)");
  if (/^\d+$/.test(s)) {
    const port = Number(s);
    if (port < 1 || port > 65535) throw new Error("Port must be 1-65535");
    return `127.0.0.1:${port}`;
  }
  // host:port form
  const m = s.match(/^([a-zA-Z0-9_.-]+):(\d+)$/);
  if (!m) throw new Error("Target must be PORT or HOST:PORT");
  const port = Number(m[2]);
  if (port < 1 || port > 65535) throw new Error("Port must be 1-65535");
  return `${m[1]}:${port}`;
}

function toView(entry) {
  if (!entry) return null;
  const pid = loadForwardPid(entry.id);
  const running = isPidAlive(pid) && childProcs.has(entry.id);
  return {
    id: entry.id,
    label: entry.label || "",
    target: entry.target,
    shortId: entry.shortId,
    customSubdomain: entry.customSubdomain || "",
    subdomain: getEffectiveSubdomain(entry),
    enabled: !!entry.enabled,
    publicUrl: publicUrlFor(entry),
    tunnelUrl: activeUrls.get(entry.id) || "",
    running,
    createdAt: entry.createdAt,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listForwards() {
  return loadForwards().map(toView);
}

export function getForward(id) {
  return toView(findById(loadForwards(), id));
}

export function createForward({ label, target, customSubdomain } = {}) {
  const normalizedTarget = validateTarget(target);
  const sub = validateCustomSubdomain(customSubdomain);
  if (sub) {
    const list = loadForwards();
    if (isSubdomainTakenLocally(list, sub, null)) {
      throw new Error(`Subdomain "${sub}" is already used by another forward on this machine`);
    }
  }
  const entry = {
    id: uuid(),
    label: String(label || "").slice(0, 80),
    target: normalizedTarget,
    shortId: generateShortId(),
    customSubdomain: sub || "",
    enabled: false,
    createdAt: new Date().toISOString(),
  };
  persist((list) => { list.push(entry); });
  return toView(entry);
}

export async function updateForward(id, patch = {}) {
  const list = loadForwards();
  const entry = findById(list, id);
  if (!entry) throw new Error("Forward not found");

  // Disallow target / subdomain change while enabled — caller must disable first.
  const changingTarget = patch.target !== undefined && validateTarget(patch.target) !== entry.target;
  const regenerating = patch.regenerateShortId === true;
  const changingSubdomain = patch.customSubdomain !== undefined
    && validateCustomSubdomain(patch.customSubdomain) !== (entry.customSubdomain || null)
    && !(patch.customSubdomain === "" && !entry.customSubdomain);
  if ((changingTarget || regenerating || changingSubdomain) && entry.enabled) {
    throw new Error("Disable the forward before changing target, URL, or subdomain");
  }

  if (patch.label !== undefined) entry.label = String(patch.label || "").slice(0, 80);
  if (changingTarget) entry.target = validateTarget(patch.target);
  if (regenerating) {
    entry.shortId = generateShortId();
    entry.customSubdomain = ""; // regenerate clears custom override
  }
  if (patch.customSubdomain !== undefined) {
    const sub = validateCustomSubdomain(patch.customSubdomain);
    if (sub && isSubdomainTakenLocally(list, sub, id)) {
      throw new Error(`Subdomain "${sub}" is already used by another forward on this machine`);
    }
    entry.customSubdomain = sub || "";
  }

  persist((l) => {
    const i = l.findIndex((f) => f.id === id);
    if (i >= 0) l[i] = entry;
  });
  return toView(entry);
}

export async function deleteForward(id) {
  await disableForward(id).catch(() => {});
  persist((l) => {
    const i = l.findIndex((f) => f.id === id);
    if (i >= 0) l.splice(i, 1);
  });
  clearForwardPid(id);
  missCounts.delete(id);
  lastRestartAt.delete(id);
  return { success: true };
}

// ─── Enable / disable ────────────────────────────────────────────────────────

export async function enableForward(id) {
  if (inFlight.has(id)) return inFlight.get(id);

  const promise = (async () => {
    const list = loadForwards();
    const entry = findById(list, id);
    if (!entry) throw new Error("Forward not found");

    // Already running with live process → return current state
    const existingPid = loadForwardPid(id);
    if (childProcs.has(id) && isPidAlive(existingPid) && activeUrls.get(id)) {
      return toView(entry);
    }

    // Stale pid (process died) → clean up
    if (existingPid && !isPidAlive(existingPid)) {
      clearForwardPid(id);
      childProcs.delete(id);
    }

    const onUrlUpdate = (newUrl) => {
      activeUrls.set(id, newUrl);
      missCounts.set(id, 0);
      registerWithWorker(getWorkerKey(entry), newUrl).catch(() => {});
    };

    const onExit = () => {
      childProcs.delete(id);
      clearForwardPid(id);
      activeUrls.delete(id);
      // User-initiated disable → don't bounce back.
      if (disabling.has(id)) {
        console.log(`[Forward] cloudflared exited for ${id} (disable)`);
        return;
      }
      console.log(`[Forward] cloudflared exited unexpectedly for ${id} (${entry.target}) — respawning`);
      // Quick respawn with a short debounce. Watchdog will catch it later if this fails.
      setTimeout(() => {
        const fresh = findById(loadForwards(), id);
        if (!fresh || !fresh.enabled) return;
        _hardRestartForward(id, "crash").catch(() => {});
      }, ON_EXIT_RESPAWN_DELAY_MS);
    };

    let result;
    try {
      result = await spawnIsolatedQuickTunnel(entry.target, onUrlUpdate, onExit);
    } catch (e) {
      // Spawn failed → leave enabled=false (caller will see error)
      throw e;
    }

    childProcs.set(id, result.child);
    activeUrls.set(id, result.tunnelUrl);
    missCounts.set(id, 0);
    saveForwardPid(id, result.child.pid);
    await registerWithWorker(getWorkerKey(entry), result.tunnelUrl);

    // Persist enabled flag
    entry.enabled = true;
    persist((l) => {
      const i = l.findIndex((f) => f.id === id);
      if (i >= 0) l[i] = entry;
    });

    return toView(entry);
  })();

  inFlight.set(id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(id);
  }
}

export async function disableForward(id) {
  const list = loadForwards();
  const entry = findById(list, id);

  // Mark disabling FIRST so onExit (fired by child.kill) skips respawn.
  disabling.add(id);

  // Persist enabled=false BEFORE killing, so any watchdog tick that lands
  // mid-teardown sees the correct intent.
  if (entry) {
    entry.enabled = false;
    persist((l) => {
      const i = l.findIndex((f) => f.id === id);
      if (i >= 0) l[i] = entry;
    });
  }

  try {
    const child = childProcs.get(id);
    if (child) {
      try { child.kill(); } catch (e) { /* ignore */ }
      childProcs.delete(id);
    }
    const pid = loadForwardPid(id);
    killIsolatedTunnel(pid, entry?.target);
    clearForwardPid(id);
    activeUrls.delete(id);
    missCounts.delete(id);
    lastRestartAt.delete(id);
  } finally {
    // Keep guard up briefly so any late onExit still sees disabling.
    setTimeout(() => disabling.delete(id), ON_EXIT_RESPAWN_DELAY_MS + 1000);
  }
  return { success: true };
}

// ─── Auto-resume on startup ──────────────────────────────────────────────────

export async function resumeForwards() {
  const list = loadForwards();
  for (const entry of list) {
    if (!entry.enabled) continue;
    // Stale PID file from previous run → clear (process is gone after restart)
    clearForwardPid(entry.id);
    try {
      await enableForward(entry.id);
      console.log(`[Forward] resumed ${entry.id} (${entry.target})`);
    } catch (e) {
      console.warn(`[Forward] resume failed ${entry.id}: ${e.message}`);
    }
  }
}

// ─── Watchdog ────────────────────────────────────────────────────────────────
// Called periodically by initializeApp. For each enabled forward:
//   - if process dead → respawn (cooldown-gated)
//   - if process alive but URL unreachable for N ticks → respawn
//   - re-register URL with worker so a stale mapping (Error 1016) self-heals
//
// Skip when no internet (avoid pointless restart loops on offline).

async function _shouldSkipRestart(id) {
  if (inFlight.has(id)) return true;
  const last = lastRestartAt.get(id) || 0;
  if (Date.now() - last < FORWARD_RESTART_COOLDOWN_MS) return true;
  return false;
}

async function _hardRestartForward(id, reason) {
  if (await _shouldSkipRestart(id)) return false;
  lastRestartAt.set(id, Date.now());
  console.log(`[Forward] restart ${id} (${reason})`);

  // Tear down current process without flipping enabled=false (preserve user intent).
  const child = childProcs.get(id);
  if (child) { try { child.kill(); } catch (e) { /* ignore */ } }
  childProcs.delete(id);
  const pid = loadForwardPid(id);
  const list = loadForwards();
  const entry = findById(list, id);
  killIsolatedTunnel(pid, entry?.target);
  clearForwardPid(id);
  activeUrls.delete(id);
  missCounts.set(id, 0);

  try {
    await enableForward(id);
    console.log(`[Forward] restart success ${id}`);
    return true;
  } catch (e) {
    console.warn(`[Forward] restart failed ${id}: ${e.message}`);
    return false;
  }
}

/** Tick health for every enabled forward. Safe to call concurrently. */
export async function tickForwardsHealth() {
  const list = loadForwards();
  const enabled = list.filter((e) => e.enabled);
  if (enabled.length === 0) return;
  if (!await checkInternet()) return; // offline → skip

  for (const entry of enabled) {
    const id = entry.id;
    const pid = loadForwardPid(id);
    const procAlive = isPidAlive(pid) && childProcs.has(id);

    if (!procAlive) {
      // Process is gone — respawn (cooldown-gated).
      _hardRestartForward(id, "process-dead").catch(() => {});
      continue;
    }

    // Process alive — probe public URL. We probe the public abc-tunnel.us URL
    // (not the *.trycloudflare.com one) because that's what users actually hit;
    // it also exercises the worker mapping, so a stale mapping triggers re-register.
    const publicUrl = publicUrlFor(entry);
    const ok = await probeUrlAlive(publicUrl);
    if (ok) {
      missCounts.set(id, 0);
      // Opportunistic re-register every successful tick: cheap, idempotent,
      // and prevents the worker from holding a wrong URL after silent rotations.
      const url = activeUrls.get(id);
      if (url) registerWithWorker(getWorkerKey(entry), url).catch(() => {});
      continue;
    }

    const misses = (missCounts.get(id) || 0) + 1;
    missCounts.set(id, misses);
    if (misses < FORWARD_MISS_THRESHOLD) continue;

    // First try: re-register the existing URL (fixes 1016 from stale mapping).
    const url = activeUrls.get(id);
    if (url) {
      const reRegistered = await registerWithWorker(getWorkerKey(entry), url);
      if (reRegistered && await probeUrlAlive(publicUrl)) {
        missCounts.set(id, 0);
        console.log(`[Forward] re-register healed ${id}`);
        continue;
      }
    }

    // Still bad → hard restart cloudflared (fixes 530 + dead trycloudflare host).
    _hardRestartForward(id, "url-unreachable").catch(() => {});
  }
}

/** Restart all enabled forwards (used on network change / sleep-wake). */
export async function restartAllForwards(reason = "external") {
  const list = loadForwards().filter((e) => e.enabled);
  for (const entry of list) {
    // Reset cooldown so the network event can force a restart.
    lastRestartAt.delete(entry.id);
    _hardRestartForward(entry.id, reason).catch(() => {});
  }
}

// ─── Test hook ───────────────────────────────────────────────────────────────

export function _internals() {
  return { childProcs, activeUrls, inFlight, lastRestartAt, missCounts, disabling };
}
