import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { requireRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// GET /api/admin/provider-options
//   Returns { providers: [{ id, name }], connections: [{ id, name, provider }] }
//   Used by ProviderAccessModal to populate dropdowns.
export async function GET(request) {
  const auth = await requireRole(request, "admin");
  if (auth.response) return auth.response;

  const [connections, nodes] = await Promise.all([
    getProviderConnections(),
    getProviderNodes().catch(() => []),
  ]);

  // Build provider name map from nodes
  const nodeNameMap = {};
  for (const n of nodes || []) {
    if (n.id && n.name) nodeNameMap[n.id] = n.name;
  }

  // Deduplicate providers from connections
  const providerSet = new Map();
  for (const c of connections) {
    if (!providerSet.has(c.provider)) {
      providerSet.set(c.provider, nodeNameMap[c.provider] || c.provider);
    }
  }

  const providers = Array.from(providerSet.entries()).map(([id, name]) => ({ id, name }));

  const connectionList = connections.map((c) => ({
    id: c.id,
    name: c.name || c.email || c.id,
    provider: c.provider,
    providerName: nodeNameMap[c.provider] || c.provider,
    isActive: c.isActive,
  }));

  return NextResponse.json({ providers, connections: connectionList });
}
