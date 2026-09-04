import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { PLAN_LIMITS } from "@/lib/flags";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  // --- Auth ---
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to upload demos." }, { status: 401 });
  }

  // --- Plan & quota check ---
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const plan = (user.publicMetadata?.plan as string) ?? "free";
  const planLimits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  // Month-keyed counter: "resets on the 1st" is only true if we actually
  // reset it. A counter stamped with a different month starts over at 0.
  const monthKey = new Date().toISOString().slice(0, 7); // "2026-09"
  const uploadsThisMonth =
    user.publicMetadata?.uploadsMonth === monthKey
      ? ((user.publicMetadata?.uploadsThisMonth as number) ?? 0)
      : 0;
  const limit = planLimits.uploadsPerMonth;

  if (limit !== Infinity && uploadsThisMonth >= limit) {
    return NextResponse.json(
      {
        error: `Upload limit reached (${limit}/month on ${plan} plan). Upgrade to upload more.`,
        upgrade_url: "/billing",
      },
      { status: 429 }
    );
  }

  // --- Validate request ---
  try {
    const { filename, size_bytes, team_id, chunk_count = 1, is_recon = false, fingerprint = null } = await req.json();

    if (!filename || (!filename.endsWith(".dem") && !filename.endsWith(".dem.gz"))) {
      return NextResponse.json({ error: "Only .dem or .dem.gz files are accepted." }, { status: 400 });
    }

    const steamId = (user.unsafeMetadata?.steam_id as string) ?? "";

    // --- Get presigned URL from FastAPI ---
    const res = await fetch(`${API_URL}/api/upload/presign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
        "Content-Type": "application/json",
        "x-clerk-user-id": userId,
        "x-clerk-user-steam-id": steamId,
      },
      body: JSON.stringify({ filename, size_bytes, team_id, chunk_count, is_recon, fingerprint }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // --- Increment usage counter ---
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        uploadsThisMonth: uploadsThisMonth + 1,
        uploadsMonth: monthKey,
      },
    });

    return NextResponse.json({ job_id: data.match_id, ...data });
  } catch {
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}
