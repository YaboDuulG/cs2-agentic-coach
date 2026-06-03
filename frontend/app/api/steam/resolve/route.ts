/**
 * DemoSage — Steam Vanity URL Resolver
 * Resolves a Steam vanity/custom URL (steamcommunity.com/id/username) to a 64-bit SteamID.
 * Uses the Steam Web API: ISteamUser/ResolveVanityURL
 */

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("url") ?? "";

  if (!input) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Extract the vanity name from a /id/<name>/ URL, or use the raw string as vanity
  const vanityMatch = input.match(/steamcommunity\.com\/id\/([^\/]+)/i);
  const vanityName = vanityMatch ? vanityMatch[1] : input.trim().replace(/\/$/, "");

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Steam Web API key not configured on server." },
      { status: 500 }
    );
  }

  try {
    const steamUrl =
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/` +
      `?key=${apiKey}&vanityurl=${encodeURIComponent(vanityName)}`;

    const res = await fetch(steamUrl, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json({ error: "Steam API request failed" }, { status: 502 });
    }

    const data = await res.json();
    const response = data?.response;

    if (response?.success === 1 && response.steamid) {
      return NextResponse.json({ steamid: response.steamid });
    } else {
      // success=42 means no match found
      return NextResponse.json(
        { error: `No Steam account found for "${vanityName}". Check the name or use your numeric profile URL.` },
        { status: 404 }
      );
    }
  } catch (err) {
    console.error("[Steam resolve] Error:", err);
    return NextResponse.json({ error: "Failed to resolve Steam vanity URL" }, { status: 500 });
  }
}
