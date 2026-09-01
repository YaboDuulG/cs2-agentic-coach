import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Proxy for POST /api/strats/{strat_id}/bind-code (api/routes/strats.py).
// Owner-only on the backend (403 otherwise); returns {team_id, code}.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ stratId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { stratId } = await params;

  const res = await fetch(`${API_URL}/api/strats/${stratId}/bind-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify({}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
