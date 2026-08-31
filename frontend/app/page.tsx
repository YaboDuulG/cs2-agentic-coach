"use client";

import { useUser, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { UploadZone } from "@/components/UploadZone";
import { UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { useTheme } from "@/lib/themes";
import { Variants, motion, useReducedMotion } from "framer-motion";
import { Target, BarChart3, Shield, Brain, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui";

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
    return (
      <div className="min-h-screen pb-24" style={{ background: "var(--gradient-hero)" }}>
        <motion.main
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="pt-24 md:pt-32 px-6 max-w-4xl mx-auto flex flex-col items-center"
        >
          <motion.h1
            variants={fadeUp}
            className="section-heading text-center mb-3"
          >
            Upload a demo
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="text-center max-w-xl mb-4"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Drop your latest match below. The report lands in{" "}
            <Link href="/profile" className="underline underline-offset-4" style={{ color: "var(--color-accent-primary)" }}>
              My Analyses
            </Link>{" "}
            when it&apos;s ready.
          </motion.p>

          {def.motifs && (
            <motion.div variants={fadeUp} className="w-full max-w-md mb-10">
              <UlziiBorder />
            </motion.div>
          )}

          <motion.div variants={fadeUp} className="w-full max-w-2xl">
            <UploadZone />
          </motion.div>
        </motion.main>
      </div>
    );
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
