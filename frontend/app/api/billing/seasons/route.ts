import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Public: the pricing page is reachable signed out and needs the season on sale.
export async function GET() {
  const res = await fetch(`${API_URL}/api/billing/seasons`, {
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    next: { revalidate: 3600 },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
