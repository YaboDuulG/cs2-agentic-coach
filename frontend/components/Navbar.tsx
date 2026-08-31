"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Upload, Shield, Compass, Menu, X } from "lucide-react";
import { SoyomboIcon } from "@/components/patterns/mongolian";
import { UploadModal } from "@/components/UploadModal";
import { useTheme } from "@/lib/themes";

export function Navbar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { def } = useTheme();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const plan = (user?.publicMetadata?.plan as string) ?? "free";
  const isAdmin = (user?.publicMetadata?.role as string) === "admin" ||
    (user?.publicMetadata?.is_admin as boolean) === true;

  const [coachingMode, setCoachingMode] = useState<"individual" | "team">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("coaching_mode") as "individual" | "team";
      if (saved === "individual" || saved === "team") return saved;
    }
    return "individual";
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<"individual" | "team">;
      if (customEvent.detail === "individual" || customEvent.detail === "team") {
        setCoachingMode(customEvent.detail);
      }
    };
    window.addEventListener("coachingModeChange", handler);
    return () => window.removeEventListener("coachingModeChange", handler);
  }, []);

  const handleToggle = (mode: "individual" | "team") => {
    setCoachingMode(mode);
    localStorage.setItem("coaching_mode", mode);
    window.dispatchEvent(new CustomEvent("coachingModeChange", { detail: mode }));
  };

  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : "Free";
  const planColor =
    plan === "pro"
      ? "var(--color-accent-secondary)"
      : plan === "basic"
        ? "var(--color-accent-primary)"
        : "var(--color-text-muted)";

  const linkStyle = (href: string): React.CSSProperties => ({
    color: pathname === href ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    transition: "color var(--dur-press) ease",
  });

  const modeButton = (mode: "individual" | "team", labelText: string) => {
    const active = coachingMode === mode;
    return (
      <button
        onClick={() => handleToggle(mode)}
        aria-pressed={active}
        className="ds-btn px-2.5 py-1 rounded-md select-none text-[11px] sm:text-xs"
        style={
          active
            ? { background: "var(--gradient-accent)", color: "#fff", fontWeight: 700 }
            : { color: "var(--color-text-secondary)", fontWeight: 600 }
        }
      >
        {labelText}
      </button>
    );
  };

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background: "color-mix(in srgb, var(--color-bg-secondary) 92%, transparent)",
          borderColor: "var(--color-border-primary)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Logo — the mark is part of the theme's identity layer */}
          <Link href="/" className="flex items-center gap-2.5 group">
            {def.motifs ? (
              <SoyomboIcon size={26} color="var(--color-accent-secondary)" />
            ) : (
              <Compass size={24} style={{ color: "var(--color-accent-secondary)" }} />
            )}
            <span
              className="font-bold text-[1.05rem] tracking-wide"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}
            >
              Demo<span style={{ color: "var(--color-accent-primary)" }}>Sage</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {user && (
              <div
                className="flex items-center rounded-lg p-0.5 shadow-inner mr-1 z-10 border"
                style={{ background: "var(--color-bg-primary)", borderColor: "var(--color-border-primary)" }}
              >
                {modeButton("individual", "Individual")}
                {modeButton("team", "Team")}
              </div>
            )}
            {user ? (
              <>
                <div className="hidden md:flex items-center gap-5 mr-3 text-sm font-medium">
                  <button
                    onClick={() => setIsUploadOpen(true)}
                    className="flex items-center gap-1.5 cursor-pointer"
                    style={{ color: "var(--color-text-secondary)", transition: "color var(--dur-press) ease" }}
                  >
                    <Upload size={13} /> Upload
                  </button>
                  <Link href="/profile" style={linkStyle("/profile")}>
                    My Analyses
                  </Link>
                  <Link href="/teams" style={linkStyle("/teams")}>
                    Teams
                  </Link>
                  {plan !== "pro" && (
                    <Link href="/billing" style={linkStyle("/billing")}>
                      Pricing
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      href="/settings/admin"
                      className="flex items-center gap-1 font-bold"
                      style={{ color: "var(--color-danger)" }}
                      title="Admin Dashboard"
                    >
                      <Shield size={12} />
                      Admin
                    </Link>
                  )}
                </div>
                <span className="text-xs font-semibold font-mono hidden sm:inline" style={{ color: planColor }}>
                  {planLabel}
                </span>
                <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
                <button
                  className="ds-btn ds-btn-ghost ds-btn-icon md:hidden"
                  onClick={() => setMenuOpen(o => !o)}
                  aria-expanded={menuOpen}
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                >
                  {menuOpen ? <X size={18} /> : <Menu size={18} />}
                </button>
              </>
            ) : (
              <>
                <div className="hidden md:flex items-center gap-5 mr-2 text-sm font-medium">
                  <Link href="/billing" style={linkStyle("/billing")}>
                    Pricing
                  </Link>
                </div>
                <SignInButton mode="modal">
                  <button className="ds-btn ds-btn-secondary ds-btn-sm">Log in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="ds-btn ds-btn-primary ds-btn-sm">Sign up</button>
                </SignUpButton>
              </>
            )}
          </div>
        </div>

        {/* Mobile menu — the md-hidden links, one per row */}
        {menuOpen && user && (
          <div
            className="md:hidden border-t px-6 py-3 flex flex-col gap-1"
            style={{ borderColor: "var(--color-border-primary)", background: "var(--color-bg-secondary)" }}
          >
            <button
              onClick={() => { setMenuOpen(false); setIsUploadOpen(true); }}
              className="flex items-center gap-2 py-2.5 text-sm font-medium text-left"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <Upload size={14} /> Upload a demo
            </button>
            <Link href="/profile" className="py-2.5 text-sm font-medium" onClick={closeMenu} style={linkStyle("/profile")}>
              My Analyses
            </Link>
            <Link href="/teams" className="py-2.5 text-sm font-medium" onClick={closeMenu} style={linkStyle("/teams")}>
              Teams
            </Link>
            <Link href="/stratbook" className="py-2.5 text-sm font-medium" onClick={closeMenu} style={linkStyle("/stratbook")}>
              Stratbook
            </Link>
            {plan !== "pro" && (
              <Link href="/billing" className="py-2.5 text-sm font-medium" onClick={closeMenu} style={linkStyle("/billing")}>
                Pricing
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/settings/admin"
                className="py-2.5 text-sm font-bold flex items-center gap-1.5"
                style={{ color: "var(--color-danger)" }}
              >
                <Shield size={13} /> Admin
              </Link>
            )}
          </div>
        )}
      </nav>
      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} defaultMode={coachingMode} />
    </>
  );
}
