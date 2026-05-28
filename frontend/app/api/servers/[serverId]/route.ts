import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { serverId } = await params;
  try {
    const res = await fetch(`${API_URL}/api/servers/${serverId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "x-clerk-user-id": userId,
      },
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: "Failed to parse API response as JSON", detail: res.statusText || "Internal Server Error" };
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to fetch from backend", detail }, { status: 500 });
  }
}
