"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

export function Navbar() {
  const pathname = usePathname();
  const { user } = useUser();
  const plan = (user?.publicMetadata?.plan as string) ?? "free";
  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : "Free";
  const planColor =
    plan === "pro"
      ? "text-yellow-400"
      : plan === "basic"
      ? "text-blue-400"
      : "text-slate-400";

  const isActive = (href: string) =>
    pathname === href ? "text-white" : "text-slate-400 hover:text-white";

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#080E1A]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="font-cinzel text-lg font-bold text-white tracking-wide">
            Demo<span className="text-[#2D7DD2]">Sage</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="hidden items-center gap-6 text-sm font-medium md:flex">
          <Link href="/" className={`transition-colors ${isActive("/")}`}>
            Upload
          </Link>
          {user && (
            <Link href="/dashboard" className={`transition-colors ${isActive("/dashboard")}`}>
              My Analyses
            </Link>
          )}
          <Link href="/billing" className={`transition-colors ${isActive("/billing")}`}>
            Pricing
          </Link>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className={`text-xs font-semibold font-mono ${planColor}`}>
                {planLabel}
              </span>
              <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
            </>
          ) : (
            <SignInButton mode="modal">
              <button className="rounded-lg border border-[#2D7DD2]/60 px-4 py-1.5 text-sm font-semibold text-[#2D7DD2] transition-all hover:bg-[#2D7DD2]/10">
                Sign In
              </button>
            </SignInButton>
          )}
        </div>
      </div>
    </nav>
  );
}
