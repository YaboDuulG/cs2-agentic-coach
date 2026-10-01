import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-8">
      <SignIn />
    </div>
  );
}
