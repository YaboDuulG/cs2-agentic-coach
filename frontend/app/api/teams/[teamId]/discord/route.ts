import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Team ↔ Discord link (api/routes/teams.py).
//   GET     status: configured, bound, and which channel of the bound group is which map
//   POST    mint the bind code `/strat bind` takes (captain only; 503 until configured)
//   DELETE  unbind (captain only)
async function forward(teamId: string, userId: string, method: "GET" | "POST" | "DELETE") {
  const suffix = method === "POST" ? "/bind-code" : "";
  try {
    const res = await fetch(`${API_URL}/api/teams/${teamId}/discord${suffix}?user_id=${encodeURIComponent(userId)}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Discord status unavailable", detail }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ teamId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return forward((await params).teamId, userId, "GET");
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return forward((await params).teamId, userId, "POST");
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return forward((await params).teamId, userId, "DELETE");
}
