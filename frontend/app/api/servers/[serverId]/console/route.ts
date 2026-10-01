import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Practice-server console (RCON through DatHost). GET tails the log; POST runs
// one command and returns the tail. Membership and plan are checked server-side.
async function forward(serverId: string, userId: string, init: RequestInit, search = "") {
  try {
    const res = await fetch(`${API_URL}/api/servers/${serverId}/console${search}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "x-clerk-user-id": userId,
      },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Console unavailable", detail }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const lines = new URL(req.url).searchParams.get("lines");
  return forward(serverId, userId, { method: "GET" }, lines ? `?lines=${encodeURIComponent(lines)}` : "");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const body = await req.json().catch(() => ({}));
  return forward(serverId, userId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: typeof body.command === "string" ? body.command : "" }),
  });
}
