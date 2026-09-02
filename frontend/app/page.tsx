"use client";

import { useEffect, useState } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { UploadZone } from "@/components/UploadZone";
import { UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { useTheme } from "@/lib/themes";
import { Variants, motion, useReducedMotion } from "framer-motion";
import { Target, BarChart3, Shield, Brain, ChevronRight, Users, BookOpen, Crosshair } from "lucide-react";
import { Card, PageSection, PageTransition, Spinner } from "@/components/ui";
import { PlanUpsellCard } from "@/components/paywall";

// Entrances: fade-up under 300ms with a strong ease-out; reduced motion keeps
// the fade and drops the movement.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const AGENTS = [
  {
    icon: Target,
    title: "The Scout",
    desc: "Reads every tick of your demo — kills, positions, utility — into a structured timeline.",
  },
  {
    icon: Shield,
    title: "Khan's Library",
    desc: "Finds how pro teams handled the same situations, pulled from recent HLTV matches.",
  },
  {
    icon: BarChart3,
    title: "The Tactician",
    desc: "Grades your opening duels, buy decisions, and grenade sequencing round by round.",
  },
  {
    icon: Brain,
    title: "The Great Khan",
    desc: "Turns the findings into a coaching report you can act on in your next match.",
  },
];

const PIPELINE = [
  { title: "Parse", desc: "Your .dem file becomes a structured record of all 24 rounds." },
  { title: "Compare", desc: "Your situations are matched against professional play." },
  { title: "Analyze", desc: "Opening duels, economy, and utility get graded." },
  { title: "Report", desc: "You get a round-by-round debrief with specific fixes." },
];

export default function HomePage() {
  const { user, isLoaded } = useUser();
  const { def } = useTheme();
  const reduceMotion = useReducedMotion();

  const fadeUp: Variants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
  };
  const stagger: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.05 } },
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg-primary)" }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (user) {
    return <CommandCenter />;
  }

  return (
    <div className="min-h-screen overflow-hidden" style={{ background: "var(--color-bg-primary)" }}>
      <main className="relative pt-28 md:pt-40 px-6 pb-24 max-w-6xl mx-auto">
        {/* Ambient identity layer — only themes that bring motifs render it */}
        {def.motifs && <CloudMotifBg className="!fixed" />}

        {/* HERO */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="relative z-10 flex flex-col items-center text-center max-w-3xl mx-auto mb-28"
        >
          <motion.p
            variants={fadeUp}
            className="text-xs font-mono font-semibold uppercase tracking-[0.2em] mb-6"
            style={{ color: "var(--color-accent-secondary)" }}
          >
            CS2 demo analysis
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className="text-5xl md:text-7xl font-bold mb-6 leading-[1.1]"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}
          >
            Every round,
            <br />
            debriefed.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg mb-10 max-w-xl leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Upload your demo. DemoSage parses every tick, checks your utility and economy
            against professional play, and writes the coaching report your team never had.
          </motion.p>

          <motion.div variants={fadeUp}>
            <SignUpButton mode="modal">
              <button className="ds-btn ds-btn-primary ds-btn-md h-11 px-6">
                Upload a demo <ChevronRight size={16} />
              </button>
            </SignUpButton>
          </motion.div>
        </motion.div>

        {def.motifs && <UlziiBorder className="relative z-10 mb-20 max-w-4xl mx-auto" />}

        {/* THE FOUR AGENTS */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
          className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4 mb-28 max-w-4xl mx-auto"
        >
          {AGENTS.map((agent) => (
            <motion.div key={agent.title} variants={fadeUp} className="card p-8 flex flex-col">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-6 border"
                style={{ background: "var(--color-accent-soft)", borderColor: "var(--color-border-primary)" }}
              >
                <agent.icon size={20} style={{ color: "var(--color-accent-primary)" }} />
              </div>
              <h3
                className="text-xl font-semibold mb-2 tracking-wide"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}
              >
                {agent.title}
              </h3>
              <p className="leading-relaxed text-sm" style={{ color: "var(--color-text-secondary)" }}>
                {agent.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>

        {/* PIPELINE — numbered because it genuinely is a sequence */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="relative z-10 max-w-3xl mx-auto"
        >
          <div className="text-center mb-14">
            <h2 className="section-heading mb-3">From demo to debrief</h2>
            <p style={{ color: "var(--color-text-secondary)" }}>
              Four steps between your upload and your report.
            </p>
          </div>

          <div className="space-y-4">
            {PIPELINE.map((step, i) => (
              <motion.div key={step.title} variants={fadeUp} className="card flex gap-5 items-start p-5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-mono font-bold border"
                  style={{
                    color: "var(--color-accent-secondary)",
                    borderColor: "var(--color-border-secondary)",
                    background: "var(--color-secondary-soft)",
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <h4 className="text-base font-semibold mb-0.5" style={{ fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>
                    {step.title}
                  </h4>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                    {step.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>

      <footer
        className="relative z-10 border-t py-12 text-center text-sm"
        style={{ borderColor: "var(--color-border-primary)", color: "var(--color-text-muted)", background: "var(--color-bg-primary)" }}
      >
        <p>© 2026 DemoSage. Built for Counter-Strike 2.</p>
      </footer>
    </div>
  );
}

// ─── Command Center — the logged-in home ───────────────────────────────────

/** Row shape returned by /api/analyses (same endpoint the profile page uses). */
interface AnalysisRow {
  match_id: string;
  map: string;
  status: string;
  created_at: string;
  is_recon?: boolean;
}

const QUICK_ROUTES = [
  { href: "/teams", icon: Users, title: "Teams", desc: "Rosters & team demos" },
  { href: "/stratbook", icon: BookOpen, title: "Stratbook", desc: "Draw and approve strats" },
  { href: "/scouting", icon: Crosshair, title: "Scouting", desc: "Opposition dossiers" },
];

// complete → success, failed → danger, everything in flight → warning.
function statusToken(status: string): string {
  const s = status.toLowerCase();
  if (s === "complete" || s === "done") return "var(--color-success)";
  if (s === "failed" || s === "error") return "var(--color-danger)";
  return "var(--color-warning)";
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusChip({ status }: { status: string }) {
  const token = statusToken(status);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide whitespace-nowrap"
      style={{
        color: token,
        background: `color-mix(in srgb, ${token} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${token} 30%, transparent)`,
      }}
    >
      {status}
    </span>
  );
}

function CommandCenter() {
  const { def } = useTheme();
  const { user } = useUser();
  const steamLinked = Boolean(user?.unsafeMetadata?.steam_id);

  // Same read pattern as Navbar: lazy localStorage init + the coachingModeChange bus.
  const [coachingMode, setCoachingMode] = useState<"individual" | "team">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("coaching_mode");
      if (saved === "individual" || saved === "team") return saved;
    }
    return "individual";
  });

  // Loading is DERIVED (loaded scope vs current mode) — no setState-in-effect.
  const [analysesData, setAnalysesData] = useState<{ scope: string; rows: AnalysisRow[] } | null>(
    null,
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<"individual" | "team">).detail;
      if (detail === "individual" || detail === "team") setCoachingMode(detail);
    };
    window.addEventListener("coachingModeChange", handler);
    return () => window.removeEventListener("coachingModeChange", handler);
  }, []);

  // The list follows the coaching-mode toggle: Individual shows your own
  // uploads, Team shows matches from any team you're on.
  useEffect(() => {
    let cancelled = false;
    const scope = coachingMode === "team" ? "team" : "personal";
    fetch(`/api/analyses?scope=${scope}`)
      .then(r => r.json())
      .catch(() => [])
      .then(data => {
        if (cancelled) return;
        setAnalysesData({ scope, rows: Array.isArray(data) ? data : [] });
      });
    return () => {
      cancelled = true;
    };
  }, [coachingMode]);

  const currentScope = coachingMode === "team" ? "team" : "personal";
  const loadingAnalyses = analysesData?.scope !== currentScope;
  const analyses = analysesData?.scope === currentScope ? analysesData.rows : [];
  const recent = analyses.slice(0, 5);

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--gradient-hero)" }}>
      <PageTransition className="pt-24 md:pt-28 px-6 max-w-6xl mx-auto">
        {/* Header */}
        <PageSection className="mb-10">
          <p
            className="text-xs font-mono font-semibold uppercase tracking-[0.2em] mb-3"
            style={{ color: "var(--color-accent-secondary)" }}
          >
            War room
          </p>
          <h1 className="section-heading mb-2">Ready when you are</h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            {coachingMode === "team" ? "Team" : "Individual"} coaching mode — switch it in the top bar.
          </p>
        </PageSection>

        {/* Individual coaching needs to know which player you are */}
        {coachingMode === "individual" && !steamLinked && (
          <PageSection className="mb-6">
            <Link
              href="/profile"
              className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
              style={{
                background: "var(--color-bg-secondary)",
                borderColor:
                  "color-mix(in srgb, var(--color-accent-secondary) 45%, transparent)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Link your Steam ID
                </span>{" "}
                so the coach knows which player is you — without it, individual reports can only
                cover the whole lobby.
              </p>
              <span
                className="text-xs font-semibold whitespace-nowrap"
                style={{ color: "var(--color-accent-primary)" }}
              >
                Link on profile →
              </span>
            </Link>
          </PageSection>
        )}

        {/* Upload hero + recent analyses */}
        <PageSection className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12 items-stretch">
          <Card className="p-6">
            <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
              Drop your latest match — the report lands in Analyses.
            </p>
            <UploadZone defaultMode={coachingMode} />
          </Card>

          <Card className="p-6 flex flex-col">
            <h2 className="text-base font-bold tracking-wide mb-4">{coachingMode === "team" ? "Team analyses" : "Recent analyses"}</h2>

            {loadingAnalyses ? (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="h-11 rounded-lg border"
                    style={{
                      background: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border-primary)",
                      opacity: 0.5,
                    }}
                  />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-10 text-center">
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  <span className="hidden lg:inline" aria-hidden>← </span>
                  No matches yet — your first upload starts here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map(a => (
                  <Link
                    key={a.match_id}
                    href={`/analysis/${a.match_id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border border-[var(--color-border-primary)] hover:border-[var(--color-border-strong)] transition-colors"
                    style={{ background: "var(--color-bg-secondary)" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                        {a.map || "Unknown map"}
                      </span>
                      {a.is_recon && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wide whitespace-nowrap"
                          style={{
                            color: "var(--color-accent-secondary)",
                            border: "1px solid color-mix(in srgb, var(--color-accent-secondary) 45%, transparent)",
                          }}
                        >
                          RECON
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <StatusChip status={a.status} />
                      <span className="font-mono text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {shortDate(a.created_at)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-auto pt-4">
              <Link
                href="/profile"
                className="text-xs font-semibold"
                style={{ color: "var(--color-accent-primary)" }}
              >
                All analyses →
              </Link>
            </div>
          </Card>
        </PageSection>

        {/* Plan-aware enticement: names what the next tier unlocks; hidden for Team tier */}
        <PageSection className="mb-6">
          <PlanUpsellCard />
        </PageSection>

        {/* Quick routes onward */}
        {def.motifs && (
          <PageSection className="mb-6">
            <UlziiBorder />
          </PageSection>
        )}
        <PageSection className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {QUICK_ROUTES.map(route => (
            <Link key={route.href} href={route.href} className="block">
              <Card className="p-5 h-full border-[var(--color-border-primary)] hover:border-[var(--color-border-strong)] transition-colors">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center mb-4 border"
                  style={{ background: "var(--color-accent-soft)", borderColor: "var(--color-border-primary)" }}
                >
                  <route.icon size={18} style={{ color: "var(--color-accent-primary)" }} />
                </div>
                <h3 className="text-base font-semibold tracking-wide mb-1">{route.title}</h3>
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                  {route.desc}
                </p>
              </Card>
            </Link>
          ))}
        </PageSection>
      </PageTransition>
    </div>
  );
}
