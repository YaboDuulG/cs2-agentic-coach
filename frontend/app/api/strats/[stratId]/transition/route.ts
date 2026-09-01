import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Proxy for POST /api/strats/{strat_id}/transition (api/routes/strats.py).
// The backend reads the caller from the x-clerk-user-id header and expects
// a {"status": "..."} body; membership is enforced server-side.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ stratId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { stratId } = await params;
  const body = await req.json();

  const res = await fetch(`${API_URL}/api/strats/${stratId}/transition`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "x-clerk-user-id": userId,
    },
    body: JSON.stringify({ status: body.status }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
