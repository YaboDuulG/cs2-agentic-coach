"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Upload } from "lucide-react";
import { SoyomboIcon } from "@/components/patterns/mongolian";
import { UploadModal } from "@/components/UploadModal";

export function Navbar() {
  const pathname = usePathname();
  const { user } = useUser();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const plan = (user?.publicMetadata?.plan as string) ?? "free";

  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : "Free";
  const planColor =
    plan === "pro" ? "text-yellow-400" : plan === "basic" ? "text-blue-400" : "text-slate-400";

  const isActive = (href: string) =>
    pathname === href ? "text-white" : "text-slate-400 hover:text-white";

  const isHome = pathname === "/";

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background: isHome ? "rgba(5,12,21,0.7)" : "rgba(8,14,26,0.92)",
          borderColor: isHome ? "rgba(255,255,255,0.06)" : "#1E3A5F",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <SoyomboIcon size={26} color="#C9A227" />
            <span style={{ fontFamily: "Cinzel, serif", fontWeight: 700, fontSize: "1.05rem", color: "#F0F4FF", letterSpacing: "0.02em" }}>
              Demo<span style={{ color: "#2D7DD2" }}>Sage</span>
            </span>
          </Link>

          {/* Right side — auth-aware */}
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center bg-[#070D18]/90 border border-[#1E3A5F]/60 rounded-lg p-0.5 text-[11px] sm:text-xs font-semibold shadow-inner mr-1 z-10">
                <Link
                  href="/profile"
                  className={`px-2.5 py-1 rounded-md transition-all duration-250 select-none ${
                    !pathname.startsWith("/teams")
                      ? "bg-gradient-to-r from-[#1B4F8A] to-[#2D7DD2] text-white shadow-sm font-bold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Individual
                </Link>
                <Link
                  href="/teams"
                  className={`px-2.5 py-1 rounded-md transition-all duration-250 select-none ${
                    pathname.startsWith("/teams")
                      ? "bg-gradient-to-r from-[#1B4F8A] to-[#2D7DD2] text-white shadow-sm font-bold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Team
                </Link>
              </div>
            )}
            {user ? (
              /* ── Logged-in nav ── */
              <>
                <div className="hidden md:flex items-center gap-5 mr-3 text-sm font-medium">
                  <button
                    onClick={() => setIsUploadOpen(true)}
                    className="transition-colors text-slate-400 hover:text-white flex items-center gap-1.5 focus:outline-none cursor-pointer"
                  >
                    <Upload size={13} /> Upload
                  </button>
                <Link href="/profile" className={`transition-colors ${isActive("/profile")}`}>
                  My Analyses
                </Link>
                <Link href="/teams" className={`transition-colors ${isActive("/teams")}`}>
                  Teams
                </Link>
                {plan !== "pro" && (
                  <Link href="/billing" className={`transition-colors ${isActive("/billing")}`}>
                    Pricing
                  </Link>
                )}
              </div>
              <span className={`text-xs font-semibold font-mono hidden sm:inline ${planColor}`}>
                {planLabel}
              </span>
              <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
            </>
          ) : (
            /* ── Logged-out nav ── */
            <>
              <div className="hidden md:flex items-center gap-5 mr-2 text-sm font-medium">
                <Link href="/billing" className={`transition-colors ${isActive("/billing")}`}>
                  Pricing
                </Link>
              </div>
              <SignInButton mode="modal">
                <button className="rounded-lg border px-4 py-1.5 text-sm font-semibold transition-all hover:bg-white/5"
                  style={{ borderColor: "rgba(45,125,210,0.4)", color: "#8BA7CC" }}>
                  Log In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #1B4F8A, #2D7DD2)", color: "#fff" }}>
                  Sign Up
                </button>
              </SignUpButton>
            </>
          )}
        </div>
      </div>
    </nav>
    <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </>
  );
}
