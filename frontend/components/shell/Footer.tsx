import Link from "next/link";

export function Footer() {
  return (
    <footer className="container-app mt-16 border-t hairline py-8 text-[12px]" style={{ color: "var(--color-text-3)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} DemoSage. Built for Counter-Strike 2. Not affiliated with Valve.</span>
        <nav className="flex gap-4" aria-label="Footer">
          <Link href="/billing" className="link">
            Pricing
          </Link>
          <a href="mailto:support@demo-sage.me" className="link">
            Support
          </a>
        </nav>
      </div>
    </footer>
  );
}
