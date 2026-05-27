import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const path = new URL(req.url).searchParams.get("view") === "analyses"
    ? `${API_URL}/api/teams/${teamId}/analyses?user_id=${userId}`
    : `${API_URL}/api/teams/${teamId}`;

  const res = await fetch(path, { cache: "no-store" });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Join team by invite code
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/teams/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, user_id: userId }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const body = await req.json();
  const res = await fetch(`${API_URL}/api/teams/${teamId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, user_id: userId }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const res = await fetch(`${API_URL}/api/teams/${teamId}?user_id=${userId}`, {
    method: "DELETE",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
