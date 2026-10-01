import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// DELETE /api/teams/[teamId]/members/[memberId]: the signed-in user leaves
// (memberId === own id) or, as captain, removes someone else. The backend
// decides which; this route only attaches the identity.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ teamId: string; memberId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId, memberId } = await params;
  try {
    const res = await fetch(
      `${API_URL}/api/teams/${teamId}/members/${encodeURIComponent(memberId)}?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` } },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to update the roster", detail }, { status: 500 });
  }
}
