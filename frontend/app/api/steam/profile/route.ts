/**
 * DemoSage — Steam Profile & Stats Loader
 * Fetches player summaries (avatar, username) and owned games playtime (CS2)
 * using the Steam Web API.
 */

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const steamid = searchParams.get("steamid") ?? "";

  if (!steamid) {
    return NextResponse.json({ error: "Missing steamid parameter" }, { status: 400 });
  }

  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Steam Web API key not configured on server." },
      { status: 500 }
    );
  }

  try {
    // 1. Fetch player summaries
    const summariesUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamid}`;
    const summariesRes = await fetch(summariesUrl, { next: { revalidate: 600 } });
    
    if (!summariesRes.ok) {
      return NextResponse.json({ error: "Failed to fetch Steam player summaries" }, { status: 502 });
    }

    const summariesData = await summariesRes.json();
    const player = summariesData?.response?.players?.[0];

    if (!player) {
      return NextResponse.json({ error: "Steam account not found" }, { status: 404 });
    }

    // 2. Fetch CS2 playtime (App ID: 730)
    // Note: IPlayerService/GetOwnedGames requires the player's game details settings to be public.
    const ownedGamesUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamid}&format=json&appids_filter[0]=730`;
    let playtime = 0;
    let playtimePrivate = false;

    try {
      const ownedGamesRes = await fetch(ownedGamesUrl, { next: { revalidate: 600 } });
      if (ownedGamesRes.ok) {
        const ownedGamesData = await ownedGamesRes.json();
        const games = ownedGamesData?.response?.games;
        if (Array.isArray(games) && games.length > 0) {
          playtime = games[0].playtime_forever ?? 0; // in minutes
        } else {
          // If games list is empty or undefined, it's either private or CS2 is not in library
          playtimePrivate = true;
        }
      } else {
        playtimePrivate = true;
      }
    } catch (err) {
      console.warn("[Steam profile] Failed to fetch playtime:", err);
      playtimePrivate = true;
    }

    return NextResponse.json({
      steamid: player.steamid,
      personaname: player.personaname,
      avatar: player.avatar,
      avatarmedium: player.avatarmedium,
      avatarfull: player.avatarfull,
      profileurl: player.profileurl,
      playtime_forever: playtime, // in minutes
      playtime_private: playtimePrivate,
    });
  } catch (err) {
    console.error("[Steam profile] Error:", err);
    return NextResponse.json({ error: "Failed to fetch Steam profile" }, { status: 500 });
  }
}
