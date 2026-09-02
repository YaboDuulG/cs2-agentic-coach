"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Upload, Shield, Compass, Menu, X } from "lucide-react";
import { SoyomboIcon } from "@/components/patterns/mongolian";
import { UploadModal } from "@/components/UploadModal";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/themes";

// The flow's spine: every page of the journey is one click away.
const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/profile", label: "Analyses" },
  { href: "/teams", label: "Teams" },
  { href: "/stratbook", label: "Stratbook" },
  { href: "/scouting", label: "Scouting" },
];

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

  const planLabel = plan === "pro" ? "Team" : plan === "basic" ? "Solo Pro" : "Free";
  const planColor =
    plan === "pro"
      ? "var(--color-accent-secondary)"
      : plan === "basic"
        ? "var(--color-accent-primary)"
        : "var(--color-text-muted)";

  // Exact match for the dashboard, prefix match for sections.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const linkColor = (active: boolean): React.CSSProperties => ({
    color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          {/* Logo — the mark is part of the theme's identity layer */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
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

          {/* Center nav — the journey's stops. Active = text-primary + a static
              2px accent underline; no animated indicator (100+/day surface). */}
          {user && (
            <div className="hidden md:flex items-center gap-1 text-sm font-medium">
              {NAV_LINKS.map(link => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="relative px-3 py-2"
                    style={linkColor(active)}
                    aria-current={active ? "page" : undefined}
                  >
                    {link.label}
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full"
                        style={{ background: "var(--color-accent-primary)" }}
                      />
                    )}
                  </Link>
                );
              })}
              {isAdmin && (
                <Link
                  href="/settings/admin"
                  className="flex items-center gap-1 px-3 py-2 font-bold"
                  style={{ color: "var(--color-danger)" }}
                  title="Admin Dashboard"
                >
                  <Shield size={12} />
                  Admin
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 flex-shrink-0">
            {user ? (
              <>
                {/* The product's one verb — always visible */}
                <Button variant="primary" size="sm" onClick={() => setIsUploadOpen(true)}>
                  <Upload size={14} /> Upload
                </Button>
                <div
                  className="flex items-center rounded-lg p-0.5 shadow-inner z-10 border"
                  style={{ background: "var(--color-bg-primary)", borderColor: "var(--color-border-primary)" }}
                >
                  {modeButton("individual", "Individual")}
                  {modeButton("team", "Team")}
                </div>
                {plan !== "pro" ? (
                  <Link
                    href="/billing"
                    className="text-xs font-semibold font-mono hidden sm:inline"
                    style={{ color: planColor }}
                    title="Plans & pricing"
                  >
                    {planLabel}
                  </Link>
                ) : (
                  <span className="text-xs font-semibold font-mono hidden sm:inline" style={{ color: planColor }}>
                    {planLabel}
                  </span>
                )}
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
                {/* Visible on every viewport — a signed-out phone user's only
                    path to pricing is this link. */}
                <div className="flex items-center gap-3 md:gap-5 mr-1 md:mr-2 text-sm font-medium">
                  <Link href="/billing" style={linkColor(isActive("/billing"))}>
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

        {/* Mobile menu — parity with the center nav, plus Upload and Admin */}
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
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="py-2.5 text-sm font-medium"
                onClick={closeMenu}
                style={linkColor(isActive(link.href))}
              >
                {link.label}
              </Link>
            ))}
            {plan !== "pro" && (
              <Link
                href="/billing"
                className="py-2.5 text-sm font-medium"
                onClick={closeMenu}
                style={linkColor(isActive("/billing"))}
              >
                Pricing
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/settings/admin"
                className="py-2.5 text-sm font-bold flex items-center gap-1.5"
                onClick={closeMenu}
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
