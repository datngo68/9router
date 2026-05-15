import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { assertSafeToEnableRemoteAccess } from "@/lib/security/tunnelGuard";

const DNS_WARMUP_DELAY_MS = 8000;

export async function POST() {
  try {
    const guard = await assertSafeToEnableRemoteAccess();
    if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const result = await enableTunnel();
    // Wait for DNS warmup to propagate at Cloudflare edge after tunnel registered
    await new Promise((r) => setTimeout(r, DNS_WARMUP_DELAY_MS));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
