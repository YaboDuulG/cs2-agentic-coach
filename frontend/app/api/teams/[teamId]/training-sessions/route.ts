import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  try {
    const res = await fetch(`${API_URL}/api/teams/${teamId}/training-sessions`, {
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`, "x-clerk-user-id": userId },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ sessions: [], total_sessions: 0, total_seconds: 0, favourite_mode: null, sessions_this_week: 0 }));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to fetch training sessions", detail }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const res = await fetch(`${API_URL}/api/teams/${teamId}/training-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-clerk-user-id": userId },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to create training session", detail }, { status: 500 });
  }
}
