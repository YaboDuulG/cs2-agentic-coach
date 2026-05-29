import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { teamId } = await params;
    
    const res = await fetch(`${API_URL}/api/teams/${teamId}/strategies`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: errorText || "Failed to fetch strategies" }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err: any) {
    console.error("Error in strategies list proxy:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
