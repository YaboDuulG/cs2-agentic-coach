"use client";

import { Show, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Menu, Palette, Settings, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandMark, Wordmark } from "@/components/identity/BrandMark";
import { ThemePicker } from "@/components/identity/ThemePicker";
import { Button } from "@/components/ui";
import { UploadModal } from "@/components/upload/UploadModal";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", exact: true },
  { href: "/matches", label: "Matches" },
  { href: "/teams", label: "Teams" },
  { href: "/stratbook", label: "Stratbook" },
] as const;

/**
 * One navbar for every route. Signed out: Pricing · Log in · Sign up.
 * Signed in: four sections, Upload, the plan chip, the Clerk user menu with
 * Settings, Plan and Theme items. On phones the sections live in a sheet;
 * Upload stays visible; nothing overflows.
 */
export function Navbar() {
  const pathname = usePathname();
  const { user } = useUser();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const meta = (user?.publicMetadata ?? {}) as { plan?: string; plan_source?: string; plan_season?: number };
  const plan = meta.plan === "pro" ? "Team" : meta.plan === "basic" ? "Solo Pro" : "Free";
  const planHint = meta.plan_source === "trial" ? "trial" : meta.plan_source === "season" && meta.plan_season ? `S${meta.plan_season}` : null;

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <>
      <nav
        className="fixed inset-x-0 top-0 z-40 border-b hairline backdrop-blur"
        style={{ height: "var(--nav-h)", background: "color-mix(in srgb, var(--color-bg) 85%, transparent)" }}
        aria-label="Primary"
      >
        <div className="container-app flex h-full items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-[17px]" aria-label="DemoSage home">
            <BrandMark size={24} />
            <Wordmark className="hidden sm:inline" />
          </Link>

          <Show when="signed-in">
            <div className="ml-4 hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href, "exact" in n && n.exact) ? "page" : undefined}
                  className={cn(
                    "rounded-(--radius-sm) px-3 py-1.5 text-sm font-semibold transition-colors duration-[var(--dur-fast)]",
                  )}
                  style={{
                    color: isActive(n.href, "exact" in n && n.exact) ? "var(--color-text)" : "var(--color-text-2)",
                    background: isActive(n.href, "exact" in n && n.exact) ? "var(--color-surface-2)" : undefined,
                  }}
                >
                  {n.label}
                </Link>
              ))}
            </div>
          </Show>

          <div className="ml-auto flex items-center gap-2">
            <Show when="signed-out">
              {/* Visible on every viewport: prospects must reach pricing from a phone. */}
              <Link href="/billing" className="px-1 text-sm font-semibold" style={{ color: "var(--color-text-2)" }}>
                Pricing
              </Link>
              <SignInButton mode="modal">
                <Button variant="secondary" size="sm">
                  Log in
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm">Sign up</Button>
              </SignUpButton>
            </Show>

            <Show when="signed-in">
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload size={14} aria-hidden="true" />
                <span>Upload</span>
              </Button>
              <Link
                href="/settings?tab=plan"
                className="num hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
                style={{ background: "var(--color-surface-2)", color: plan === "Free" ? "var(--color-text-2)" : "var(--color-rank)" }}
                aria-label={`Plan: ${plan}${planHint ? ` (${planHint})` : ""}`}
              >
                {plan}
                {planHint ? <span className="ml-1 opacity-70">{planHint}</span> : null}
              </Link>
              <button
                type="button"
                className="hidden rounded-(--radius-sm) p-2 transition-colors duration-[var(--dur-fast)] hover:bg-(--color-surface-2) md:inline-flex"
                aria-label="Theme"
                title="Theme"
                onClick={() => setThemeOpen(true)}
                style={{ color: "var(--color-text-2)" }}
              >
                <Palette size={16} />
              </button>
              <Link
                href="/settings"
                className="hidden rounded-(--radius-sm) p-2 transition-colors duration-[var(--dur-fast)] hover:bg-(--color-surface-2) md:inline-flex"
                aria-label="Settings"
                title="Settings"
                style={{ color: "var(--color-text-2)" }}
              >
                <Settings size={16} />
              </Link>
              <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} userProfileMode="navigation" userProfileUrl="/settings/account" />
              <button
                type="button"
                className="rounded-(--radius-sm) p-2 md:hidden"
                aria-label={sheetOpen ? "Close menu" : "Open menu"}
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen((v) => !v)}
              >
                {sheetOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </Show>
          </div>
        </div>

        {sheetOpen ? (
          <div className="surface enter absolute inset-x-(--gutter) top-[calc(var(--nav-h)+8px)] p-2 md:hidden" role="dialog" aria-label="Sections">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setSheetOpen(false)}
                className="block rounded-(--radius-sm) px-3 py-2.5 text-sm font-semibold"
                style={{
                  color: isActive(n.href, "exact" in n && n.exact) ? "var(--color-text)" : "var(--color-text-2)",
                  background: isActive(n.href, "exact" in n && n.exact) ? "var(--color-surface-2)" : undefined,
                }}
              >
                {n.label}
              </Link>
            ))}
            <Link
              href="/settings"
              onClick={() => setSheetOpen(false)}
              className="block rounded-(--radius-sm) px-3 py-2.5 text-sm font-semibold"
              style={{ color: "var(--color-text-2)" }}
            >
              Settings
            </Link>
            <div className="mt-1 border-t hairline pt-2">
              <p className="eyebrow px-3 py-1">Theme</p>
              <ThemePicker compact />
            </div>
          </div>
        ) : null}
      </nav>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      {themeOpen ? (
        <ThemeSheet onClose={() => setThemeOpen(false)} />
      ) : null}
    </>
  );
}

function ThemeSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose} role="presentation">
      <div
        className="surface enter w-full max-w-md p-5"
        role="dialog"
        aria-label="Choose a theme"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base">Theme</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1" style={{ color: "var(--color-text-2)" }}>
            <X size={16} />
          </button>
        </div>
        <ThemePicker />
      </div>
    </div>
  );
}
