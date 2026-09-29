import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const AUTH = { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` };

// Trial-code minting and listing. Admin only (404 otherwise).
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const res = await fetch(`${API_URL}/api/admin/promo-codes`, { headers: AUTH, cache: "no-store" });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/admin/promo-codes?user_id=${gate.userId}`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
