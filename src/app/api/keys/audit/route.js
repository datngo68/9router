import { NextResponse } from "next/server";
import { getKeyAuditLog } from "@/lib/db/repos/keyAuditRepo.js";

export const dynamic = "force-dynamic";

// GET /api/keys/audit?keyId=...&limit=...
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get("keyId") || null;
    const limit = Number(searchParams.get("limit")) || 200;
    const entries = await getKeyAuditLog({ keyId, limit });
    return NextResponse.json({ entries });
  } catch (error) {
    console.log("Error fetching audit log:", error);
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }
}
