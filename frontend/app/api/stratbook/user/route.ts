import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Personal strategy save/list. The real Clerk user id is injected server-side
// — the page must never supply its own.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/stratbook/user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "Content-Type": "application/json",
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify({ ...body, user_id: userId }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await fetch(`${API_URL}/api/stratbook/user?user_id=${userId}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
