import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { matchId } = await params;

  // Retrieve user's Steam ID from Clerk metadata
  let steamId = "";
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    steamId = (user.unsafeMetadata?.steam_id as string) ?? "";
  } catch (err) {
    console.error("Failed to fetch user metadata from Clerk:", err);
  }

  const res = await fetch(
    `${API_URL}/api/coaching/${matchId}?user_id=${userId}&uploader_steam_id=${steamId}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      },
    }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
