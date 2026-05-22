import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-[calc(100vh-56px)] items-center justify-center bg-[#080E1A] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-cinzel text-3xl font-bold text-white">
            Join DemoSage
          </h1>
          <p className="mt-2 text-slate-400">
            Start with 2 free demo analyses — no card required
          </p>
        </div>
        <SignUp
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "bg-white/5 border border-white/10 shadow-2xl rounded-2xl",
              headerTitle: "text-white font-cinzel",
              headerSubtitle: "text-slate-400",
              socialButtonsBlockButton:
                "border border-white/10 bg-white/5 text-white hover:bg-white/10",
              dividerLine: "bg-white/10",
              dividerText: "text-slate-500",
              formFieldLabel: "text-slate-300",
              formFieldInput:
                "bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-[#2D7DD2]",
              formButtonPrimary:
                "bg-[#2D7DD2] hover:bg-[#2D7DD2]/80 text-white font-semibold",
              footerActionLink: "text-[#2D7DD2] hover:text-[#2D7DD2]/80",
            },
          }}
        />
      </div>
    </main>
  );
}
