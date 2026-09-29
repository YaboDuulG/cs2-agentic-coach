import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Tier, entitlements, and expiry for the signed-in user, from the backend's
// subscriptions table (the authority) rather than Clerk metadata.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${API_URL}/api/billing/entitlements?user_id=${userId}`, {
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
