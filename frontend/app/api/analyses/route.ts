import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // scope=personal (default) | team | all; rows carry team_id and mode.
  const requested = req.nextUrl.searchParams.get("scope");
  const scope = requested === "team" || requested === "all" ? requested : "personal";
  const res = await fetch(`${API_URL}/api/analyses?user_id=${userId}&scope=${scope}`, { cache: "no-store", headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}` } });
  return NextResponse.json(await res.json(), { status: res.status });
}
