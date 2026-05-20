"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Input, Button } from "@/shared/components";

function fmtVnd(v) { return Number(v || 0).toLocaleString("vi-VN"); }

const FIELDS = [
  { key: "inputVnd", label: "Input" },
  { key: "outputVnd", label: "Output" },
  { key: "cachedVnd", label: "Cached" },
  { key: "reasoningVnd", label: "Reasoning" },
  { key: "cacheCreationVnd", label: "Cache create" },
];

export default function PaygPricingPage() {
  const [pricing, setPricing] = useState({});
  const [loading, setLoading] = useState(true);
  const [savedMsg, setSavedMsg] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({});
  const [newKey, setNewKey] = useState({ provider: "", model: "", inputVnd: "", outputVnd: "" });

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/payg-pricing", { cache: "no-store" });
    const data = await res.json();
    setPricing(data.pricing || {});
    setDraft({});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    return Object.entries(pricing).map(([key, value]) => ({ key, value }));
  }, [pricing]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter((r) => r.key.toLowerCase().includes(q));
  }, [rows, search]);

  function setField(key, field, value) {
    setDraft((d) => ({
      ...d,
      [key]: { ...(d[key] || pricing[key] || {}), [field]: value },
    }));
  }

  async function saveAll() {
    const entries = {};
    for (const [key, value] of Object.entries(draft)) {
      const cleaned = {};
      for (const f of FIELDS) {
        const n = Number(value[f.key]);
        if (Number.isFinite(n) && n >= 0) cleaned[f.key] = n;
      }
      if (cleaned.inputVnd != null && cleaned.outputVnd != null) {
        entries[key] = cleaned;
      }
    }
    if (Object.keys(entries).length === 0) return;
    const res = await fetch("/api/admin/payg-pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (res.ok) {
      setSavedMsg(`Đã lưu ${Object.keys(entries).length} entries`);
      setTimeout(() => setSavedMsg(""), 3000);
      await load();
    }
  }

  async function removeKey(key) {
    if (!confirm(`Xoá pricing cho ${key}? Model này sẽ bị block khỏi PAYG.`)) return;
    await fetch(`/api/admin/payg-pricing?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    await load();
  }

  async function addNew() {
    const provider = newKey.provider.trim();
    const model = newKey.model.trim();
    if (!model) return;
    const k = provider ? `${provider}|${model}` : model;
    const entry = {
      inputVnd: Number(newKey.inputVnd) || 0,
      outputVnd: Number(newKey.outputVnd) || 0,
    };
    await fetch("/api/admin/payg-pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: { [k]: entry } }),
    });
    setNewKey({ provider: "", model: "", inputVnd: "", outputVnd: "" });
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">PAYG Pricing</h1>
        <p className="text-sm text-text-muted">Bảng giá VND/1M tokens cho từng model. Nếu không cấu hình, model sẽ bị từ chối khi user dùng PAYG.</p>
      </header>

      <Card>
        <h2 className="font-semibold mb-3">Thêm dòng mới</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          <Input placeholder="provider (vd: openai)" value={newKey.provider} onChange={(e) => setNewKey({ ...newKey, provider: e.target.value })} />
          <Input placeholder="model (bắt buộc, vd: gpt-5)" value={newKey.model} onChange={(e) => setNewKey({ ...newKey, model: e.target.value })} />
          <Input type="number" placeholder="Input VND/1M" value={newKey.inputVnd} onChange={(e) => setNewKey({ ...newKey, inputVnd: e.target.value })} />
          <Input type="number" placeholder="Output VND/1M" value={newKey.outputVnd} onChange={(e) => setNewKey({ ...newKey, outputVnd: e.target.value })} />
          <Button onClick={addNew}>Thêm</Button>
        </div>
        <p className="mt-2 text-xs text-text-muted">Để trống provider để tạo entry chung cho mọi provider. Dùng tiền tố <code>pattern:</code> trong tên model để dùng glob (vd: <code>pattern:claude-opus-*</code>).</p>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <Input placeholder="Tìm theo provider/model..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          <div className="flex items-center gap-2">
            {savedMsg && <span className="text-xs text-green-600">{savedMsg}</span>}
            <Button onClick={saveAll} disabled={Object.keys(draft).length === 0}>Lưu thay đổi ({Object.keys(draft).length})</Button>
          </div>
        </div>
        {loading ? (
          <p className="text-text-muted py-4 text-center">Đang tải...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-text-muted py-8 text-center">Chưa cấu hình giá PAYG nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-2 text-left">Key</th>
                  {FIELDS.map((f) => <th key={f.key} className="px-2 py-2 text-right">{f.label}</th>)}
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ key, value }) => {
                  const d = draft[key] || value;
                  const dirty = !!draft[key];
                  return (
                    <tr key={key} className={`border-b border-border-subtle/50 ${dirty ? "bg-amber-500/5" : ""}`}>
                      <td className="px-2 py-2 font-mono text-xs">{key}</td>
                      {FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-1">
                          <input
                            type="number"
                            value={d[f.key] ?? ""}
                            onChange={(e) => setField(key, f.key, e.target.value)}
                            className="w-24 rounded border border-border bg-bg px-2 py-1 text-right text-xs"
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right">
                        <button onClick={() => removeKey(key)} className="text-xs text-red-500 hover:underline">Xoá</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-text-muted">Đơn vị: VND / 1.000.000 tokens. Tiền sẽ được trừ chính xác theo số tokens thực tế.</p>
      </Card>
    </div>
  );
}
