/**
 * DemoSage — Admin User Provisioning Route
 * POST /api/admin/provision
 *
 * Creates (or promotes) a Clerk user to admin role by setting publicMetadata.role = "admin".
 * Protected by ADMIN_PROVISION_SECRET — only callable with the correct secret.
 *
 * Usage:
 *   curl -X POST https://your-domain.com/api/admin/provision \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"<ADMIN_PROVISION_SECRET>","email":"admin@example.com","password":"<password>"}'
 */

import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { secret, email, password } = body;

  // Gate: only runs if the correct provision secret is supplied
  const provisionSecret = process.env.ADMIN_PROVISION_SECRET;
  if (!provisionSecret || secret !== provisionSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Check if user already exists
    const existing = await client.users.getUserList({ emailAddress: [email] });

    let userId: string;

    if (existing.data.length > 0) {
      // Promote existing user to admin
      userId = existing.data[0].id;
      await client.users.updateUser(userId, {
        publicMetadata: { ...existing.data[0].publicMetadata, role: "admin", plan: "pro" },
      });
      return NextResponse.json({
        status: "promoted",
        message: `Existing user ${email} promoted to admin.`,
        userId,
      });
    } else {
      // Create new admin user
      const newUser = await client.users.createUser({
        emailAddress: [email],
        password,
        publicMetadata: { role: "admin", plan: "pro" },
      });
      userId = newUser.id;
      return NextResponse.json({
        status: "created",
        message: `Admin user ${email} created successfully.`,
        userId,
      });
    }
  } catch (err: any) {
    console.error("[Admin provision] Error:", err);
    const message = err?.errors?.[0]?.longMessage ?? err?.message ?? "Failed to provision admin user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
