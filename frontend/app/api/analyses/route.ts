import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // scope=personal (default) | team — drives the Command Center mode toggle
  const scope = req.nextUrl.searchParams.get("scope") === "team" ? "team" : "personal";
  const res = await fetch(`${API_URL}/api/analyses?user_id=${userId}&scope=${scope}`, { cache: "no-store", headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}` } });
  return NextResponse.json(await res.json(), { status: res.status });
}
