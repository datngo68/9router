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

import crypto from "crypto";
import {
  loadForwards, saveForwards, generateShortId,
  saveForwardPid, loadForwardPid, clearForwardPid,
} from "./state.js";
import {
  spawnIsolatedQuickTunnel, killIsolatedTunnel, isPidAlive,
} from "./cloudflared.js";

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";

const childProcs = new Map();   // id -> child process
const activeUrls = new Map();   // id -> last tunnelUrl
const inFlight = new Map();     // id -> Promise (guards concurrent enable)

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
  try {
    await fetch(`${WORKER_URL}/api/tunnel/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortId, tunnelUrl }),
    });
  } catch (e) {
    console.warn(`[Forward] worker register failed (${shortId}): ${e.message}`);
  }
}

function publicUrlFor(shortId) {
  return `https://r${shortId}.abc-tunnel.us`;
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
    enabled: !!entry.enabled,
    publicUrl: publicUrlFor(entry.shortId),
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

export function createForward({ label, target } = {}) {
  const normalized = validateTarget(target);
  const entry = {
    id: uuid(),
    label: String(label || "").slice(0, 80),
    target: normalized,
    shortId: generateShortId(),
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

  // Disallow target/shortId change while enabled — caller must disable first.
  const changingTarget = patch.target !== undefined && validateTarget(patch.target) !== entry.target;
  const regenerating = patch.regenerateShortId === true;
  if ((changingTarget || regenerating) && entry.enabled) {
    throw new Error("Disable the forward before changing target or regenerating URL");
  }

  if (patch.label !== undefined) entry.label = String(patch.label || "").slice(0, 80);
  if (changingTarget) entry.target = validateTarget(patch.target);
  if (regenerating) entry.shortId = generateShortId();

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
      registerWithWorker(entry.shortId, newUrl).catch(() => {});
    };

    const onExit = () => {
      childProcs.delete(id);
      clearForwardPid(id);
      // Keep `enabled=true` in storage so watchdog/auto-resume can revive it.
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
    saveForwardPid(id, result.child.pid);
    await registerWithWorker(entry.shortId, result.tunnelUrl);

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

  const child = childProcs.get(id);
  if (child) {
    try { child.kill(); } catch (e) { /* ignore */ }
    childProcs.delete(id);
  }
  const pid = loadForwardPid(id);
  killIsolatedTunnel(pid, entry?.target);
  clearForwardPid(id);
  activeUrls.delete(id);

  if (entry) {
    entry.enabled = false;
    persist((l) => {
      const i = l.findIndex((f) => f.id === id);
      if (i >= 0) l[i] = entry;
    });
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

// ─── Test hook ───────────────────────────────────────────────────────────────

export function _internals() {
  return { childProcs, activeUrls, inFlight };
}
