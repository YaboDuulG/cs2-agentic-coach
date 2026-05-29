import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { teamId } = await params;
    const body = await req.json();

    const res = await fetch(`${API_URL}/api/teams/${teamId}/strategies/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: errorText || "Chat failed" }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err: any) {
    console.error("Error in strategies chat proxy:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
