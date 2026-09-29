import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Per-team cost table: Gemini spend, server hours, season revenue, margin.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const window = req.nextUrl.searchParams.get("window") ?? "season";
  const res = await fetch(`${API_URL}/api/admin/team-metering?window=${encodeURIComponent(window)}`, {
    headers: { Authorization: `Bearer ${process.env.API_SHARED_SECRET}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
