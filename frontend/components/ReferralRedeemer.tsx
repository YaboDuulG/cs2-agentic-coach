"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui";

// Completes a referral sign-up: the code arrives in unsafeMetadata from the
// sign-up page, and the first signed-in render redeems it once. The redeem
// route stamps `referral_attempted` on publicMetadata whatever the outcome,
// so this never retries a rejected code.
export function ReferralRedeemer() {
  const { user, isLoaded } = useUser();
  const ran = useRef(false);

  useEffect(() => {
    if (!isLoaded || !user || ran.current) return;
    const code = user.unsafeMetadata?.referral_code as string | undefined;
    const meta = user.publicMetadata as { referral_attempted?: boolean; referral_redeemed?: boolean };
    if (!code || meta.referral_attempted || meta.referral_redeemed) return;
    ran.current = true;

    (async () => {
      try {
        const res = await fetch("/api/billing/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, source: "signup" }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(`Invite accepted — ${data.days} days of Solo Pro are on your account.`);
        } else {
          toast.error(data.error ?? "That invite code could not be applied.");
        }
      } catch {
        toast.error("Could not apply your invite code. You can enter it on your profile.");
      } finally {
        await user.reload();
      }
    })();
  }, [isLoaded, user]);

  return null;
}
