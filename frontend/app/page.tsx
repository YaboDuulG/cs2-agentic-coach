"use client";

import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { UploadZone } from "@/components/UploadZone";
import { motion } from "framer-motion";
import { 
  Target, BarChart3, Zap, Shield, 
  Brain, Users, ChevronRight, CheckCircle2 
} from "lucide-react";

const FADE_UP = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

const STAGGER = {
  hidden: { opacity: 0 },
  visible: { transition: { staggerChildren: 0.1 } }
};

const FEATURES = [
  { 
    icon: Target, 
    title: "First Contact Resolution", 
    desc: "Map which players consistently win the opening duel and control early info.",
    colSpan: "md:col-span-2"
  },
  { 
    icon: Shield, 
    title: "Utility Sequencing", 
    desc: "Grenade usage scored against pro player patterns from HLTV match data.",
    colSpan: "md:col-span-1"
  },
  { 
    icon: BarChart3, 
    title: "Economy Coherence", 
    desc: "Round-by-round buy decisions graded against optimal strategy for your rank.",
    colSpan: "md:col-span-1"
  },
  { 
    icon: Brain, 
    title: "Agentic Orchestration", 
    desc: "Gemini-powered analysis processes your demo and writes personalized coaching reports.",
    colSpan: "md:col-span-2"
  },
];

export default function HomePage() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white selection:bg-white/30 font-sans selection:text-white pb-24">
        {/* Sleek Header */}
        <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium tracking-tight">
              <div className="w-5 h-5 rounded bg-white" />
              DemoSage
            </div>
            <div className="flex items-center gap-6 text-sm text-neutral-400">
              <Link href="/profile" className="hover:text-white transition-colors">Analyses</Link>
              <Link href="/teams" className="hover:text-white transition-colors">Teams</Link>
              <Link href="/stratbook" className="hover:text-white transition-colors">Stratbook</Link>
            </div>
          </div>
        </header>

        <motion.main 
          initial="hidden" animate="visible" variants={STAGGER}
          className="pt-32 px-6 max-w-4xl mx-auto flex flex-col items-center"
        >
          <motion.div variants={FADE_UP} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-neutral-300 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            System Online
          </motion.div>

          <motion.h1 variants={FADE_UP} className="text-4xl md:text-6xl font-semibold tracking-tight text-center mb-4 leading-tight">
            Deploy Match Intelligence
          </motion.h1>
          <motion.p variants={FADE_UP} className="text-neutral-400 text-center max-w-xl mb-12">
            Upload your `.dem` file. Our agentic pipeline will parse the events, analyze your tactics, and generate an executive report.
          </motion.p>

          <motion.div variants={FADE_UP} className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-2xl p-2 shadow-2xl">
            <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-8">
              <UploadZone />
            </div>
          </motion.div>
        </motion.main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white selection:bg-white/30 font-sans selection:text-white overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] opacity-20 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/20 to-transparent blur-3xl rounded-full" />
      </div>

      <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#0A0A0A]/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium tracking-tight">
            <div className="w-5 h-5 rounded bg-white text-black flex items-center justify-center text-[10px] font-bold">DS</div>
            DemoSage
          </div>
          <div className="flex items-center gap-4 text-sm">
            <SignInButton mode="modal">
              <button className="text-neutral-400 hover:text-white transition-colors cursor-pointer">Log in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="bg-white text-black px-4 py-1.5 rounded-full font-medium hover:bg-neutral-200 transition-colors cursor-pointer">
                Sign up
              </button>
            </SignUpButton>
          </div>
        </div>
      </header>

      <main className="pt-40 px-6 pb-24 max-w-6xl mx-auto">
        {/* HERO */}
        <motion.div 
          initial="hidden" animate="visible" variants={STAGGER}
          className="flex flex-col items-center text-center max-w-3xl mx-auto mb-32"
        >
          <motion.div variants={FADE_UP} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-neutral-300 mb-8">
            <Zap size={14} className="text-blue-400" />
            CS2 Performance Engineering
          </motion.div>
          
          <motion.h1 variants={FADE_UP} className="text-5xl md:text-7xl font-semibold tracking-tighter mb-6 leading-[1.1]">
            Agentic coaching for <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-neutral-200 to-neutral-600">
              competitive teams.
            </span>
          </motion.h1>

          <motion.p variants={FADE_UP} className="text-lg text-neutral-400 mb-10 max-w-xl leading-relaxed">
            Upload your demo. Our multi-agent pipeline parses every tick, compares your utility and positioning against HLTV pro data, and writes a personalized tactical report.
          </motion.p>

          <motion.div variants={FADE_UP} className="flex items-center gap-4">
            <SignUpButton mode="modal">
              <button className="h-11 px-6 rounded-full bg-white text-black font-medium flex items-center gap-2 hover:bg-neutral-200 transition-all hover:scale-105 active:scale-95 cursor-pointer">
                Get Started <ChevronRight size={16} />
              </button>
            </SignUpButton>
          </motion.div>
        </motion.div>

        {/* BENTO GRID */}
        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }} variants={STAGGER}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-32"
        >
          {FEATURES.map((feat, i) => (
            <motion.div 
              key={i} variants={FADE_UP}
              className={`p-8 rounded-3xl bg-neutral-900/50 border border-white/10 flex flex-col justify-between group hover:bg-neutral-900 transition-colors ${feat.colSpan}`}
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <feat.icon size={20} className="text-neutral-300" />
                </div>
                <h3 className="text-xl font-medium mb-2 tracking-tight">{feat.title}</h3>
                <p className="text-neutral-400 leading-relaxed">{feat.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* WORKFLOW / ARCHITECTURE */}
        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true }} variants={STAGGER}
          className="border-t border-white/10 pt-24 max-w-4xl mx-auto"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">How the pipeline works</h2>
            <p className="text-neutral-400">A deterministic parser meets non-deterministic reasoning.</p>
          </div>

          <div className="space-y-6">
            {[
              { title: "The Scout (Parse)", desc: "A high-performance Go parser extracts 3D coordinates, kills, and utility from the .dem file into a structured relational schema." },
              { title: "Khan's Library (RAG)", desc: "Our embedding pipeline retrieves similar tactical situations from recent HLTV professional matches via Qdrant Cloud." },
              { title: "The Tactician (Analysis)", desc: "Rule-based heuristics evaluate your First Contact Resolution and Economy Coherence across all 24 rounds." },
              { title: "The Great Khan (Synthesis)", desc: "Gemini 2.5 orchestrates the findings, generating an executive-level summary and actionable coaching feedback." }
            ].map((step, i) => (
              <motion.div key={i} variants={FADE_UP} className="flex gap-6 items-start p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-sm font-medium">
                  {i + 1}
                </div>
                <div>
                  <h4 className="text-lg font-medium mb-1 tracking-tight">{step.title}</h4>
                  <p className="text-neutral-400 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>

      <footer className="border-t border-white/5 py-12 text-center text-sm text-neutral-500 bg-[#0A0A0A]">
        <p>© 2026 DemoSage. Architected for Counter-Strike 2.</p>
      </footer>
    </div>
  );
}
