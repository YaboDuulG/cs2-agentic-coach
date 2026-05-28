import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { match_id, filename, chunk_count, team_id } = await req.json();

    const res = await fetch(`${API_URL}/api/upload/compose`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "Content-Type": "application/json",
        "x-clerk-user-id": userId,
      },
      body: JSON.stringify({ match_id, filename, chunk_count, team_id }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Composition failed", detail }, { status: 502 });
  }
}
