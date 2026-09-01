import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Proxy for GET /api/strats/?team_id=... (api/routes/strats.py list_strats).
// The backend reads the caller from the x-clerk-user-id header and enforces
// team membership; it wraps the list as {"strats": [...]}, which is unwrapped
// here to the StratSummary[] the typed client expects.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;

  const res = await fetch(
    `${API_URL}/api/strats/?team_id=${encodeURIComponent(teamId)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "x-clerk-user-id": userId,
      },
    }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  return NextResponse.json(data.strats ?? []);
}
