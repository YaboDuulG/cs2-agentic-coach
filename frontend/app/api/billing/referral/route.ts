import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// The signed-in user's own invite code plus a ready-to-share sign-up link.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${API_URL}/api/billing/referral-code?user_id=${userId}`, {
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const origin = req.nextUrl.origin;
  return NextResponse.json({
    ...data,
    share_url: `${origin}/sign-up?ref=${encodeURIComponent(data.code)}`,
  });
}
