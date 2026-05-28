import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/servers/modes`, {
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ modes: [], update_window_active: false }, { status: 200 });
  }
}
