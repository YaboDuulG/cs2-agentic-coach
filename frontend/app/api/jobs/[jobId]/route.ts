import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { jobId } = await params;
  // light=true keeps poll ticks payload-free; the page fetches full data once.
  const light = req.nextUrl.searchParams.get("light") === "1" ? "&light=true" : "";
  try {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}?user_id=${userId}${light}`, { cache: "no-store", headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}` } });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to fetch job status" }, { status: 502 });
  }
}
