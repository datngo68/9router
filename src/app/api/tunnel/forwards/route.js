import { NextResponse } from "next/server";
import { listForwards, createForward } from "@/lib/tunnel/forwards";

export async function GET() {
  try {
    return NextResponse.json({ forwards: listForwards() });
  } catch (error) {
    console.error("Forwards list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const forward = createForward({
      label: body.label,
      target: body.target,
      customSubdomain: body.customSubdomain,
    });
    return NextResponse.json({ forward }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
