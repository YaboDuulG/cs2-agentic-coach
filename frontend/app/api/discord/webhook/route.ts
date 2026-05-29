import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get("team_id");
  if (!teamId) {
    return NextResponse.json({ error: "Missing team_id parameter" }, { status: 400 });
  }

  try {
    const body = await req.json();
    
    // Forward the payload to the FastAPI backend webhook handler
    const res = await fetch(`${API_URL}/api/discord/webhook?team_id=${teamId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: errorText || "Ingestion failed" }, { status: res.status });
    }

    return NextResponse.json(await res.json());
  } catch (err: any) {
    console.error("Error in Discord webhook proxy:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
