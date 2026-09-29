import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// DatHost credits + servers switched on, for the admin metering panel.
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const res = await fetch(`${API_URL}/api/admin/dathost-account`, {
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
