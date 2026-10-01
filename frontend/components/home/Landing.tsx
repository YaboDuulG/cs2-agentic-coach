import { SignUpButton } from "@clerk/nextjs";
import { Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";

const STEPS = [
  { n: "01", title: "Upload", body: "Drop the .dem from your match history. Teammates' duplicates are detected and never re-parsed." },
  { n: "02", title: "We parse and compare", body: "Every tick becomes kills, trades, utility and economy, then gets measured against pro play on the same map." },
  { n: "03", title: "You get a debrief", body: "Findings with the round and the clock, a pro benchmark for each, and the drill that fixes it." },
];

const SAMPLE = {
  round: 14,
  clock: "1:07",
  category: "Rotation",
  severity: "High",
  text: "Rotated from B 11 seconds after the A contact; pro average on Anubis is 4. The site fell before the second player arrived.",
  benchmark: "Tier-1 rotation delay on Anubis: 4.2s",
};

/** Signed-out front door. Complete at rest: no scroll-triggered reveals. */
export function Landing() {
  return (
    <div className="enter">
      <section className="mx-auto max-w-3xl py-10 text-center sm:py-16">
        <p className="eyebrow mb-3">CS2 demo analysis</p>
        <h1 className="text-4xl sm:text-5xl">Every round, debriefed.</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] sm:text-lg" style={{ color: "var(--color-text-2)" }}>
          Upload your demo. DemoSage parses every tick, checks your duels, utility and economy against professional play, and
          writes the coaching report your team never had.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <SignUpButton mode="modal">
            <Button size="lg">Upload a demo</Button>
          </SignUpButton>
          <Button asChild variant="secondary" size="lg">
            <Link href="/billing">See pricing</Link>
          </Button>
        </div>
        <p className="num mt-3 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          2 free uploads a month · no card
        </p>
      </section>

      <section aria-label="What a finding looks like" className="mx-auto max-w-2xl">
        <div className="surface p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="num rounded-full px-2 py-0.5 font-semibold" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}>
              R{SAMPLE.round} · {SAMPLE.clock}
            </span>
            <span className="eyebrow">{SAMPLE.category}</span>
            <span className="ml-auto rounded-full px-2 py-0.5 font-semibold" style={{ background: "color-mix(in srgb, var(--color-danger) 14%, transparent)", color: "var(--color-danger)" }}>
              {SAMPLE.severity}
            </span>
          </div>
          <p className="text-[15px]">{SAMPLE.text}</p>
          <p className="num mt-3 text-[12px]" style={{ color: "var(--color-text-2)" }}>
            Benchmark · {SAMPLE.benchmark}
          </p>
        </div>
        <p className="mt-2 text-center text-[12px]" style={{ color: "var(--color-text-3)" }}>
          A real finding from a real debrief, shortened.
        </p>
      </section>

      <section className="mx-auto mt-14 max-w-4xl">
        <h2 className="mb-6 text-center text-2xl">From demo to debrief</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="surface p-5">
              <p className="num eyebrow mb-2">{s.n}</p>
              <h3 className="text-base">{s.title}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-14 max-w-4xl">
        <h2 className="mb-2 text-center text-2xl">Three ways to use it</h2>
        <p className="mb-6 text-center text-sm" style={{ color: "var(--color-text-2)" }}>
          Pick when you upload. Nothing to configure.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { t: "Coach me", d: "Personal findings about your duels, positioning and utility.", plan: "Free · Solo Pro" },
            { t: "Coach my team", d: "Trades, defaults, retakes, utility stacks. A report for every player.", plan: "Team" },
            { t: "Scout an opponent", d: "Their buys, defaults and habits, filed under your team as a dossier.", plan: "Team" },
          ].map((c) => (
            <div key={c.t} className="surface p-5">
              <h3 className="text-base">{c.t}</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                {c.d}
              </p>
              <p className="eyebrow mt-3">{c.plan}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-14 max-w-3xl">
        <div className="surface flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl">Solo Pro $10 a month. Team $300 per ESEA season.</h2>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm sm:justify-start" style={{ color: "var(--color-text-2)" }}>
              {["Cancel anytime", "Seats for the whole roster", "Practice servers included"].map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <Check size={14} style={{ color: "var(--color-good)" }} aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <Button asChild variant="secondary">
            <Link href="/billing">Compare plans</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
