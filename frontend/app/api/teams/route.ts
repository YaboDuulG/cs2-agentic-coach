import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { planHeaderFor } from "@/lib/server/plan";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${API_URL}/api/teams?user_id=${userId}`, { cache: "no-store", headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}` } });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  // Team is a hard paywall on the backend; the header is its Clerk fallback.
  const res = await fetch(`${API_URL}/api/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "x-user-plan": await planHeaderFor(userId),
    },
    body: JSON.stringify({ ...body, user_id: userId }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
