import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Proxy for GET /api/strats/{strat_id} (api/routes/strats.py get_strat).
// Returns the strat summary plus its revisions (each with the parsed canvas
// JSON); the backend reads the caller from the x-clerk-user-id header and
// enforces team membership server-side.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ stratId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { stratId } = await params;

  const res = await fetch(`${API_URL}/api/strats/${stratId}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "x-clerk-user-id": userId,
    },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
