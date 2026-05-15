import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel/tunnelManager";
import { assertSafeToEnableRemoteAccess } from "@/lib/security/tunnelGuard";

export async function POST() {
  try {
    const guard = await assertSafeToEnableRemoteAccess();
    if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
