import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Server-side admin gate for app/api/admin/* routes. The FastAPI side only
// checks the shared secret, so this is the enforcement point: the role comes
// from Clerk publicMetadata (role === "admin" or is_admin === true), read
// fresh from Clerk rather than from session claims so a revoked admin loses
// access at the next request, not the next sign-in.
//
// Non-admins get a 404, not a 403: the route's existence is not revealed.
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const meta = (user.publicMetadata ?? {}) as { role?: string; is_admin?: boolean };
  if (meta.role !== "admin" && meta.is_admin !== true) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true, userId };
}
