import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";

// OpenID 2.0 callback. Runs inside the Clerk session (cookie auth), verifies
// the assertion with Steam via check_authentication, then writes the SteamID64
// into unsafeMetadata.steam_id — the single field the whole coaching identity
// chain (upload proxy, coaching proxy, evidence pack) reads.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/", req.url));

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/profile?steam=error&reason=${reason}`, req.url));

  const sp = req.nextUrl.searchParams;
  const claimed = sp.get("openid.claimed_id") ?? "";
  const match = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/);
  if (!match) return fail("claimed_id");

  // Ask Steam directly whether this assertion is genuine — never trust the
  // redirect parameters alone.
  const verify = new URLSearchParams();
  sp.forEach((value, key) => verify.set(key, value));
  verify.set("openid.mode", "check_authentication");
  let verified = false;
  try {
    const resp = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verify.toString(),
    });
    verified = (await resp.text()).includes("is_valid:true");
  } catch {
    verified = false;
  }
  if (!verified) return fail("verification");

  const steamId = match[1];
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  await clerk.users.updateUser(userId, {
    unsafeMetadata: { ...user.unsafeMetadata, steam_id: steamId },
  });

  return NextResponse.redirect(new URL("/profile?steam=linked", req.url));
}
