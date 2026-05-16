import { NextResponse } from "next/server";
import { getCustomers, getCustomerById, getOrders, getApiKeysByCustomer, updateCustomer } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.toLowerCase() || "";
  const customers = await getCustomers();
  const filtered = search
    ? customers.filter((c) => `${c.email} ${c.displayName || ""} ${c.phone || ""}`.toLowerCase().includes(search))
    : customers;
  return NextResponse.json({ customers: filtered });
}
