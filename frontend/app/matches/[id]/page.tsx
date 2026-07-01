"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CloudMotifBg, UlziiBorder } from "@/components/patterns/mongolian";
import { ChevronLeft, Crosshair, MapPin, Skull, Target, Clock, Shield } from "lucide-react";
import Link from "next/link";

interface MatchDetails {
  id: string;
  map: string;
  score_t: number;
  score_ct: number;
  duration: number;
  source: string;
  players: {
    name: string;
    kills: number;
    deaths: number;
    assists: number;
    mvps: number;
    headshot_pct: number;
    team: "T" | "CT";
  }[];
}

export default function MatchDetailsPage() {
  const { id } = useParams();
  const router = useRouter();
  const [match, setMatch] = useState<MatchDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock fetching match details
    setTimeout(() => {
      setMatch({
        id: id as string,
        map: "de_mirage",
        score_t: 13,
        score_ct: 11,
        duration: 2540,
        source: "FACEIT",
        players: [
          { name: "S1mple", kills: 30, deaths: 12, assists: 4, mvps: 5, headshot_pct: 60, team: "T" },
          { name: "ZywOo", kills: 28, deaths: 15, assists: 6, mvps: 4, headshot_pct: 55, team: "CT" },
          { name: "NiKo", kills: 22, deaths: 18, assists: 3, mvps: 2, headshot_pct: 70, team: "T" },
          { name: "Donk", kills: 20, deaths: 19, assists: 5, mvps: 1, headshot_pct: 58, team: "CT" },
        ]
      });
      setLoading(false);
    }, 1000);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin border-[var(--color-accent-primary)]" />
      </div>
    );
  }

  if (!match) return <div className="p-20 text-center">Match not found</div>;

  return (
    <div className="min-h-screen px-6 py-20 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <CloudMotifBg />
      <div className="relative max-w-5xl mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm font-semibold mb-6 text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)] transition-colors">
          <ChevronLeft size={16} /> Back
        </button>

        <div className="card-elevated p-8 mb-8 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <MapPin size={120} />
          </div>
          <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
            <div className="flex-1 text-center md:text-left">
              <h1 className="section-heading mb-2">{match.map}</h1>
              <div className="flex items-center justify-center md:justify-start gap-4 text-sm text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1"><Clock size={14} /> {Math.floor(match.duration / 60)}:{String(match.duration % 60).padStart(2, '0')}</span>
                <span className="flex items-center gap-1 bg-[var(--color-accent-glow)] px-2 py-0.5 rounded-full text-[10px] font-bold border border-[var(--color-accent-primary)] text-[var(--color-accent-primary)]">
                  ⚡ {match.source}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-8 bg-[var(--color-bg-secondary)] px-8 py-4 rounded-2xl border border-[var(--color-border-primary)] shadow-inner">
              <div className="text-center">
                <p className="text-sm font-bold text-[#FF9500] mb-1">TERRORIST</p>
                <p className="text-5xl font-heading font-black">{match.score_t}</p>
              </div>
              <div className="text-2xl font-bold text-[var(--color-text-muted)]">-</div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#00adee] mb-1">COUNTER</p>
                <p className="text-5xl font-heading font-black">{match.score_ct}</p>
              </div>
            </div>
          </div>
        </div>

        <UlziiBorder className="mb-8" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* T Team */}
          <div className="card p-6">
            <h3 className="text-xl font-heading font-bold mb-4 flex items-center gap-2 text-[#FF9500]">
              <Target size={20} /> Terrorist Team
            </h3>
            <div className="space-y-2">
              {match.players.filter(p => p.team === "T").map(p => (
                <div key={p.name} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] hover:border-[var(--color-accent-primary)] transition-colors">
                  <span className="font-bold font-mono">{p.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1" title="Kills"><Crosshair size={14} className="text-[var(--color-text-muted)]" /> {p.kills}</span>
                    <span className="flex items-center gap-1" title="Deaths"><Skull size={14} className="text-[var(--color-text-muted)]" /> {p.deaths}</span>
                    <span className="text-[var(--color-text-muted)] text-xs">{p.headshot_pct}% HS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CT Team */}
          <div className="card p-6">
            <h3 className="text-xl font-heading font-bold mb-4 flex items-center gap-2 text-[#00adee]">
              <Shield size={20} /> Counter-Terrorist
            </h3>
            <div className="space-y-2">
              {match.players.filter(p => p.team === "CT").map(p => (
                <div key={p.name} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] hover:border-[#00adee] transition-colors">
                  <span className="font-bold font-mono">{p.name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1" title="Kills"><Crosshair size={14} className="text-[var(--color-text-muted)]" /> {p.kills}</span>
                    <span className="flex items-center gap-1" title="Deaths"><Skull size={14} className="text-[var(--color-text-muted)]" /> {p.deaths}</span>
                    <span className="text-[var(--color-text-muted)] text-xs">{p.headshot_pct}% HS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href={`/coach?match=${match.id}`} className="btn-primary inline-flex items-center gap-2">
            Ask The Khan About This Match
          </Link>
        </div>
      </div>
    </div>
  );
}
