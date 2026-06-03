import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { matchId } = await params;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${matchId}/notes?user_id=${userId}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 502 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { matchId } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/api/analyses/${matchId}/notes?user_id=${userId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update notes", detail: errorMsg }, { status: 502 });
  }
}
