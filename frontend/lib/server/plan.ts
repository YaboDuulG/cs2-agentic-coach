import { clerkClient } from "@clerk/nextjs/server";

// The backend's entitlement check reads the subscriptions table first and the
// x-user-plan header only as the Clerk fallback (trial grants, admin-set
// plans). publicMetadata is writable only through Clerk's backend API, so the
// value is trusted; a Clerk outage degrades to "free", never to "pro".
export async function planHeaderFor(userId: string): Promise<string> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    return (user.publicMetadata?.plan as string) ?? "free";
  } catch {
    return "free";
  }
}
