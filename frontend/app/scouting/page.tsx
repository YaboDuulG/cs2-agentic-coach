"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Crosshair, MapPin } from "lucide-react";
import { ModeSwitchedReport } from "@/components/analysis";
import { Card, PageSection, PageTransition } from "@/components/ui";
import { useCoaching } from "@/lib/api/hooks";

// Same list endpoint the profile page uses (/api/analyses proxy → backend
// /api/analyses?user_id=). is_recon is optional: older API builds omit it,
// in which case no match can be identified as recon and the empty state shows.
interface Analysis {
  match_id: string;
  map: string;
  status: string;
  created_at: string;
  is_recon?: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "Just now";
}

export default function ScoutingPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [analyses, setAnalyses] = useState<Analysis[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const coaching = useCoaching(selected);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.push("/sign-in");
      return;
    }
    fetch("/api/analyses")
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => setAnalyses(Array.isArray(a) ? a : []))
      .catch(() => setAnalyses([]));
  }, [user, isLoaded, router]);

  if (!isLoaded || !user) return null;

  const recon = (analyses ?? []).filter((a) => a.is_recon === true);
  const loading = analyses === null;

  return (
    <div className="min-h-screen px-6 py-16" style={{ background: "var(--color-bg-primary)" }}>
      <PageTransition className="mx-auto max-w-5xl">
        <PageSection>
          <header className="mb-8">
            <div className="flex items-center gap-2">
              <Crosshair size={16} style={{ color: "var(--color-accent-secondary)" }} />
              <span
                className="text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-secondary)" }}
              >
                Opposition research
              </span>
            </div>
            <h1 className="section-heading mt-1" style={{ fontSize: "1.6rem" }}>
              Scouting dossiers
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Recon demos analyzed for opponent tendencies, buy-round behavior, and default setups.
            </p>
          </header>
        </PageSection>

        <PageSection>
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading recon matches">
            <div className="card h-16 animate-pulse" />
            <div className="card h-16 animate-pulse" style={{ opacity: 0.7 }} />
            <div className="card h-16 animate-pulse" style={{ opacity: 0.4 }} />
          </div>
        ) : recon.length === 0 ? (
          <Card className="p-10 text-center">
            <Crosshair
              size={32}
              className="mx-auto mb-3"
              style={{ color: "var(--color-text-muted)" }}
            />
            <h2 className="text-base font-bold" style={{ color: "var(--color-text-primary)" }}>
              No recon matches yet
            </h2>
            <p
              className="mx-auto mt-2 max-w-md text-sm leading-relaxed"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Upload an opponent&apos;s demo and tick the recon checkbox on the upload form —
              it will be analyzed as opposition research and show up here as a dossier.
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Recon match picker */}
            <div className="space-y-2">
              {recon.map((a) => {
                const isSelected = selected === a.match_id;
                return (
                  <button
                    key={a.match_id}
                    onClick={() => setSelected(a.match_id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                    style={{
                      background: isSelected
                        ? "var(--color-accent-soft)"
                        : "var(--color-bg-card)",
                      borderColor: isSelected
                        ? "var(--color-border-strong)"
                        : "var(--color-border-primary)",
                    }}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--color-secondary-soft)",
                        border: "1px solid var(--color-border-secondary)",
                      }}
                    >
                      <MapPin size={15} style={{ color: "var(--color-accent-secondary)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-semibold"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {a.map || "Unknown map"}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {a.status} · {a.created_at ? timeAgo(a.created_at) : "—"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Dossier for the selected match */}
            <div className="lg:col-span-2">
              {selected ? (
                <ModeSwitchedReport
                  coaching={coaching.data}
                  isLoading={coaching.isPending}
                />
              ) : (
                <Card className="flex h-40 items-center justify-center p-6">
                  <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    Select a recon match to open its dossier.
                  </p>
                </Card>
              )}
              {selected && coaching.isError && (
                <p className="mt-3 text-xs" style={{ color: "var(--color-danger)" }}>
                  Failed to load the coaching report for this match.
                </p>
              )}
              {selected &&
                !coaching.isPending &&
                !coaching.isError &&
                coaching.data &&
                coaching.data.status !== "pending" &&
                !coaching.data.coaching?.report_v2 && (
                  <Card className="flex h-40 items-center justify-center p-6">
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                      This match predates the dossier report format — re-run the analysis
                      to generate one.
                    </p>
                  </Card>
                )}
            </div>
          </div>
        )}
        </PageSection>
      </PageTransition>
    </div>
  );
}
