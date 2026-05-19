import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const CONTACT_KEYS = [
  "contactEmail",
  "contactPhone",
  "contactTelegram",
  "contactZalo",
  "contactFacebook",
  "contactAddress",
  "contactBusinessHours",
  "contactNote",
];

// GET /api/store/contact — public list of contact channels for /store/contact.
// Returns only the contact* fields from settings (no secrets).
export async function GET() {
  try {
    const settings = await getSettings();
    const contact = {};
    for (const k of CONTACT_KEYS) {
      const v = settings?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        contact[k] = String(v);
      }
    }
    return NextResponse.json({
      contact,
      storeName: settings?.storeName || "9Router",
    });
  } catch (e) {
    console.log("[/api/store/contact] failed:", e?.message);
    return NextResponse.json({ contact: {}, storeName: "9Router" });
  }
}
