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
  } catch (err) {
    console.error("Error in strategies list proxy:", err);
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { teamId } = await params;
    const body = await req.json();

    const res = await fetch(`${API_URL}/api/teams/${teamId}/strategies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: errorText || "Failed to save strategy" }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("Error in strategy create proxy:", err);
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
