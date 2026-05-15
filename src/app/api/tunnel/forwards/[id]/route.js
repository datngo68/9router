import { NextResponse } from "next/server";
import {
  getForward, updateForward, deleteForward,
  enableForward, disableForward,
} from "@/lib/tunnel/forwards";

export async function GET(_req, { params }) {
  const { id } = await params;
  const forward = getForward(id);
  if (!forward) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ forward });
}

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (body.action === "enable") {
      const forward = await enableForward(id);
      return NextResponse.json({ forward });
    }
    if (body.action === "disable") {
      await disableForward(id);
      return NextResponse.json({ forward: getForward(id) });
    }

    const forward = await updateForward(id, {
      label: body.label,
      target: body.target,
      regenerateShortId: body.regenerateShortId === true,
    });
    return NextResponse.json({ forward });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const { id } = await params;
    await deleteForward(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
