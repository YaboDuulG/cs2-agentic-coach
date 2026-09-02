import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// Steam "Sign in through Steam" is OpenID 2.0 — no API key or app
// registration needed. We send the user to Steam; Steam sends them back to
// /api/steam/callback with a signed assertion carrying their SteamID64.
const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/", req.url));

  const origin = req.nextUrl.origin;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${origin}/api/steam/callback`,
    "openid.realm": origin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return NextResponse.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
}
