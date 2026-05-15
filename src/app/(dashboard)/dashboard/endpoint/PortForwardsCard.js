"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const POLL_INTERVAL_MS = 5000;

export default function PortForwardsCard() {
  const [forwards, setForwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});       // id -> "enabling" | "disabling" | "deleting"
  const [error, setError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEnableModal, setShowEnableModal] = useState(null); // pending forward
  const [confirmState, setConfirmState] = useState(null);
  const [editing, setEditing] = useState(null);

  const [newLabel, setNewLabel] = useState("");
  const [newTarget, setNewTarget] = useState("");

  const { copied, copy } = useCopyToClipboard();

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/tunnel/forwards", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setForwards(Array.isArray(data.forwards) ? data.forwards : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
    const id = setInterval(fetchList, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchList]);

  function setBusyFor(id, value) {
    setBusy((prev) => {
      const next = { ...prev };
      if (value) next[id] = value; else delete next[id];
      return next;
    });
  }

  async function handleCreate() {
    setError("");
    if (!newTarget.trim()) {
      setError("Target is required (e.g. 7000 or 192.168.1.50:7000)");
      return;
    }
    try {
      const res = await fetch("/api/tunnel/forwards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel, target: newTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      setShowAddModal(false);
      setNewLabel("");
      setNewTarget("");
      await fetchList();
    } catch (e) { setError(e.message); }
  }

  async function handleEnable(forward) {
    setShowEnableModal(null);
    setBusyFor(forward.id, "enabling");
    try {
      const res = await fetch(`/api/tunnel/forwards/${forward.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enable failed");
      await fetchList();
    } catch (e) {
      setError(`${forward.target}: ${e.message}`);
    } finally {
      setBusyFor(forward.id, null);
    }
  }

  async function handleDisable(forward) {
    setBusyFor(forward.id, "disabling");
    try {
      await fetch(`/api/tunnel/forwards/${forward.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable" }),
      });
      await fetchList();
    } finally {
      setBusyFor(forward.id, null);
    }
  }

  async function handleDelete(forward) {
    setBusyFor(forward.id, "deleting");
    try {
      await fetch(`/api/tunnel/forwards/${forward.id}`, { method: "DELETE" });
      await fetchList();
    } finally {
      setBusyFor(forward.id, null);
      setConfirmState(null);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setError("");
    try {
      const res = await fetch(`/api/tunnel/forwards/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editing.label,
          target: editing.target,
          regenerateShortId: editing.regenerate === true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setEditing(null);
      await fetchList();
    } catch (e) { setError(e.message); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">lan</span>
          Port Forwarding
        </h2>
        <Button icon="add" onClick={() => { setNewLabel(""); setNewTarget(""); setError(""); setShowAddModal(true); }}>
          Add Forward
        </Button>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Expose a local port (or LAN host:port) to the internet via a stable
        <code className="mx-1 px-1 rounded bg-surface-2">https://r&lt;id&gt;.abc-tunnel.us</code> URL.
        The URL stays the same across restarts.
      </p>

      {error && (
        <div className="p-2 rounded text-sm bg-red-500/10 text-red-600 dark:text-red-400 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : forwards.length === 0 ? (
        <div className="text-center py-8 text-sm text-text-muted">
          No forwards yet. Add one to expose a local service.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {forwards.map((f) => (
            <ForwardRow
              key={f.id}
              forward={f}
              busy={busy[f.id]}
              copied={copied}
              onCopy={copy}
              onEnable={() => setShowEnableModal(f)}
              onDisable={() => handleDisable(f)}
              onEdit={() => setEditing({ id: f.id, label: f.label, target: f.target, enabled: f.enabled, regenerate: false })}
              onDelete={() => setConfirmState({
                title: "Delete forward",
                message: `Delete ${f.label || f.target}? The public URL will stop working.`,
                onConfirm: () => handleDelete(f),
              })}
            />
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal isOpen={showAddModal} title="Add Port Forward" onClose={() => setShowAddModal(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium block mb-1">Label (optional)</label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="My webhook server"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Target</label>
            <Input
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="7000  or  192.168.1.50:7000"
            />
            <p className="text-xs text-text-muted mt-1">
              Bare port → 127.0.0.1. Use HOST:PORT to reach a LAN device.
            </p>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2 mt-1">
            <Button onClick={handleCreate} fullWidth>Add</Button>
            <Button onClick={() => setShowAddModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Enable warn modal */}
      <Modal
        isOpen={!!showEnableModal}
        title="Enable Forward"
        onClose={() => setShowEnableModal(null)}
      >
        <div className="flex flex-col gap-3">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px]">warning</span>
              <div>
                <p className="font-medium mb-1">Public access</p>
                <p>
                  Anyone with the URL <code className="px-1 rounded bg-black/10">{showEnableModal?.publicUrl}</code> will reach <code className="px-1 rounded bg-black/10">{showEnableModal?.target}</code>.
                  Make sure the target service has its own auth or trusts public access.
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleEnable(showEnableModal)} fullWidth>Enable</Button>
            <Button onClick={() => setShowEnableModal(null)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        isOpen={!!editing}
        title="Edit Forward"
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Label</label>
              <Input
                value={editing.label || ""}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Target</label>
              <Input
                value={editing.target}
                onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                disabled={editing.enabled}
              />
              {editing.enabled && (
                <p className="text-xs text-text-muted mt-1">Disable forward first to change target.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!editing.regenerate}
                onChange={(e) => setEditing({ ...editing, regenerate: e.target.checked })}
                disabled={editing.enabled}
              />
              Regenerate URL (assign a new random shortId)
            </label>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <div className="flex gap-2 mt-1">
              <Button onClick={handleSaveEdit} fullWidth>Save</Button>
              <Button onClick={() => setEditing(null)} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </Card>
  );
}

function ForwardRow({ forward, busy, copied, onCopy, onEnable, onDisable, onEdit, onDelete }) {
  const isEnabling = busy === "enabling";
  const isDisabling = busy === "disabling";
  const isDeleting = busy === "deleting";
  const showUrl = forward.enabled && !isEnabling && !isDisabling;

  return (
    <div className="flex items-center gap-2 py-2 border-b border-black/3 dark:border-white/3 last:border-b-0">
      <div className="shrink-0 min-w-[160px]">
        <p className="text-sm font-medium truncate">{forward.label || forward.target}</p>
        <p className="text-xs text-text-muted font-mono">{forward.target}</p>
      </div>

      {showUrl ? (
        <>
          <Input value={forward.publicUrl} readOnly className="flex-1 font-mono text-sm" />
          <button
            onClick={() => onCopy(forward.publicUrl, `fwd_${forward.id}`)}
            className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
            title="Copy URL"
          >
            <span className="material-symbols-outlined text-[18px]">
              {copied === `fwd_${forward.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span
            className={`text-xs px-2 py-1 rounded shrink-0 ${
              forward.running ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}
            title={forward.running ? "cloudflared process up" : "process not running yet"}
          >
            {forward.running ? "running" : "starting"}
          </span>
          <button
            onClick={onDisable}
            disabled={isDisabling}
            className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
            title="Disable"
          >
            <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
          </button>
        </>
      ) : isEnabling || isDisabling ? (
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
          <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
          {isEnabling ? "Creating tunnel..." : "Disabling..."}
        </div>
      ) : (
        <>
          <Input value={forward.publicUrl} readOnly className="flex-1 font-mono text-sm opacity-60" />
          <Button size="sm" icon="cloud_upload" onClick={onEnable}>Enable</Button>
        </>
      )}

      <button
        onClick={onEdit}
        className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
        title="Edit"
      >
        <span className="material-symbols-outlined text-[18px]">edit</span>
      </button>
      <button
        onClick={onDelete}
        disabled={isDeleting || forward.enabled}
        className="p-2 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-colors shrink-0 disabled:opacity-30"
        title={forward.enabled ? "Disable first" : "Delete"}
      >
        <span className="material-symbols-outlined text-[18px]">delete</span>
      </button>
    </div>
  );
}

ForwardRow.propTypes = {
  forward: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string,
    target: PropTypes.string.isRequired,
    publicUrl: PropTypes.string.isRequired,
    enabled: PropTypes.bool,
    running: PropTypes.bool,
  }).isRequired,
  busy: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onEnable: PropTypes.func.isRequired,
  onDisable: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
