import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify Vercel cron signature
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const clerk = await clerkClient();

    let reset = 0;
    let page = 0;
    const limit = 100;

    // Paginate through all users
    while (true) {
      const users = await clerk.users.getUserList({ limit, offset: page * limit });
      if (!users.data.length) break;

      for (const user of users.data) {
        const uploads = (user.publicMetadata?.uploadsThisMonth as number) ?? 0;
        if (uploads > 0) {
          await clerk.users.updateUserMetadata(user.id, {
            publicMetadata: { ...user.publicMetadata, uploadsThisMonth: 0 },
          });
          reset++;
        }
      }

      if (users.data.length < limit) break;
      page++;
    }

    console.log(`[cron/reset-quotas] Reset ${reset} users at ${new Date().toISOString()}`);
    return NextResponse.json({ ok: true, reset });
  } catch (err) {
    console.error("[cron/reset-quotas] Error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
