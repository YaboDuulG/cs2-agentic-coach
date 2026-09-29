import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Redeem a trial or referral code. The backend owns the rules and writes the
// subscriptions row (the entitlement authority); this route adds what only
// Clerk knows (account age) and mirrors the result into publicMetadata so the
// navbar chip and the upload quota reflect the trial immediately.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code, source } = (await req.json()) as { code?: string; source?: string };
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const accountAgeDays = (Date.now() - user.createdAt) / 86_400_000;
  const meta = (user.publicMetadata ?? {}) as Record<string, unknown>;

  const res = await fetch(`${API_URL}/api/billing/redeem?user_id=${userId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.API_SHARED_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code, account_age_days: accountAgeDays }),
  });
  const data = await res.json();

  // A sign-up referral is attempted once, whatever the outcome, so the
  // client never loops on a code that was rejected.
  const attemptFlag = source === "signup" ? { referral_attempted: true } : {};

  if (!res.ok) {
    if (source === "signup") {
      await clerk.users.updateUserMetadata(userId, { publicMetadata: { ...meta, ...attemptFlag } });
    }
    const detail = data?.detail ?? {};
    return NextResponse.json(
      { error: detail.message ?? "That code could not be redeemed.", code: detail.code ?? "invalid" },
      { status: res.status },
    );
  }

  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...meta,
      ...attemptFlag,
      plan: data.plan,
      plan_source: "trial",
      plan_expires: data.until,
      ...(data.kind === "referral" ? { referral_redeemed: true } : {}),
    },
  });

  return NextResponse.json(data);
}
