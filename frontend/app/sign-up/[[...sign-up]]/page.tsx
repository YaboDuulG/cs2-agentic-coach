import { SignUp } from "@clerk/nextjs";

// `?ref=CODE` (a friend's invite link) rides along as Clerk unsafeMetadata;
// ReferralRedeemer turns it into a week of Solo Pro after the first sign-in.
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const referralCode = typeof ref === "string" ? ref.trim().toUpperCase().slice(0, 32) : "";
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 py-8">
      {referralCode ? (
        <p className="surface-2 px-4 py-2 text-sm">
          Invite code <span className="num font-semibold">{referralCode}</span>: a free week of Solo Pro once you sign up.
        </p>
      ) : null}
      <SignUp unsafeMetadata={referralCode ? { referral_code: referralCode } : undefined} />
    </div>
  );
}
