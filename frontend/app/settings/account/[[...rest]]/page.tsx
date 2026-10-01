import { UserProfile } from "@clerk/nextjs";

/** Clerk's account management, inside the shell and the theme. */
export default function AccountPage() {
  return (
    <div className="flex justify-center py-4">
      <UserProfile routing="path" path="/settings/account" />
    </div>
  );
}
