import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Message-ingestion relay. This route has no session, so it adds no authority
// of its own: the sender's HMAC (X-Webhook-Signature over the raw body, keyed
// with DISCORD_WEBHOOK_SECRET) is passed through untouched and the backend
// verifies it. The body is forwarded as bytes because re-serialising JSON
// would change them and break the signature.
export async function POST(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get("team_id");
  if (!teamId) {
    return NextResponse.json({ error: "Missing team_id parameter" }, { status: 400 });
  }
  const signature = req.headers.get("x-webhook-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing X-Webhook-Signature header" }, { status: 401 });
  }

  try {
    const res = await fetch(`${API_URL}/api/discord/webhook?team_id=${encodeURIComponent(teamId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature },
      body: await req.arrayBuffer(),
    });
    const data = await res.json().catch(() => ({ error: "Ingestion failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Error in Discord webhook proxy:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
