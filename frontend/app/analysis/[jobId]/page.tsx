"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { CheckCircle, AlertCircle, Clock, Crosshair, TrendingUp, Layers } from "lucide-react";

type JobStatus = "queued" | "processing" | "done" | "failed";

interface KillEvent {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
}

interface RoundResult {
  round: number;
  winner: string;
  ct_spend: number;
  t_spend: number;
}

interface JobResult {
  status: JobStatus;
  map?: string;
  total_rounds?: number;
  total_kills?: number;
  total_grenades?: number;
  kills?: KillEvent[];
  rounds?: RoundResult[];
  error?: string;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued:     { label: "Queued",     color: "#8BA7CC", icon: <Clock size={16} /> },
  processing: { label: "Parsing…",  color: "#2D7DD2", icon: <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} /> },
  done:       { label: "Complete",  color: "#22D3A0", icon: <CheckCircle size={16} /> },
  failed:     { label: "Failed",    color: "#FF4D6D", icon: <AlertCircle size={16} /> },
};

export default function AnalysisPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [result, setResult] = useState<JobResult | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;

    async function poll() {
      while (!stopped) {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          const data: JobResult = await res.json();
          setResult(data);
          if (data.status === "done" || data.status === "failed") break;
        } catch { /* continue polling */ }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    poll();
    return () => { stopped = true; };
  }, [jobId]);

  const status = result?.status ?? "queued";
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="min-h-screen px-6 py-16" style={{ background: "#080E1A" }}>
      <CloudMotifBg />

      <div className="relative max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <SoyomboIcon size={36} color="#C9A227" />
          <div>
            <h1 className="heading-display" style={{ fontSize: "1.6rem" }}>
              {result?.map ?? "Demo Analysis"}
            </h1>
            <div className="flex items-center gap-2 mt-1" style={{ color: cfg.color }}>
              {cfg.icon}
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{cfg.label}</span>
            </div>
          </div>
        </div>

        <UlziiBorder className="mb-10" />

        {/* Processing state */}
        {(status === "queued" || status === "processing") && (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-6"
              style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
            <h2 className="heading-display mb-3" style={{ fontSize: "1.4rem" }}>
              The Khan is reading your demo…
            </h2>
            <p style={{ color: "#8BA7CC" }}>
              Parsing rounds, kills, and utility. This takes 30–90 seconds.
            </p>
          </div>
        )}

        {/* Error state */}
        {status === "failed" && (
          <div className="card p-10 text-center" style={{ borderColor: "rgba(255,77,109,0.3)" }}>
            <AlertCircle size={40} color="#FF4D6D" className="mx-auto mb-4" />
            <h2 className="heading-display mb-2" style={{ fontSize: "1.3rem" }}>Parse Failed</h2>
            <p style={{ color: "#8BA7CC" }}>{result?.error ?? "Unknown error. Please try uploading again."}</p>
          </div>
        )}

        {/* Results */}
        {status === "done" && result && (
          <div className="space-y-6 animate-fade-in-up">

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { icon: Layers, label: "Rounds", value: result.total_rounds ?? 0 },
                { icon: Crosshair, label: "Kills", value: result.total_kills ?? 0 },
                { icon: TrendingUp, label: "Grenades", value: result.total_grenades ?? 0 },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="card p-6 text-center">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3"
                    style={{ background: "rgba(45,125,210,0.1)", border: "1px solid rgba(45,125,210,0.2)" }}>
                    <Icon size={20} color="#2D7DD2" />
                  </div>
                  <div className="stat-number" style={{ fontSize: "2rem" }}>{value}</div>
                  <div style={{ color: "#8BA7CC", fontSize: "0.8rem", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Kill feed */}
            {result.kills && result.kills.length > 0 && (
              <div className="card p-6">
                <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>
                  Kill Feed
                </h2>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {result.kills.slice(0, 50).map((k, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b"
                      style={{ borderColor: "#142135" }}>
                      <div className="flex items-center gap-3">
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem", fontFamily: "JetBrains Mono" }}>
                          R{k.round}
                        </span>
                        <span style={{ color: "#22D3A0", fontWeight: 500, fontSize: "0.875rem" }}>
                          {k.killer}
                        </span>
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem" }}>killed</span>
                        <span style={{ color: "#FF4D6D", fontSize: "0.875rem" }}>{k.victim}</span>
                      </div>
                      <span style={{ color: "#8BA7CC", fontSize: "0.75rem", fontFamily: "JetBrains Mono" }}>
                        {k.weapon}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Round economy */}
            {result.rounds && result.rounds.length > 0 && (
              <div className="card p-6">
                <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>
                  Economy by Round
                </h2>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {result.rounds.map((r) => {
                    const maxSpend = Math.max(r.ct_spend, r.t_spend, 1);
                    return (
                      <div key={r.round} className="flex items-center gap-4">
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem", fontFamily: "JetBrains Mono", width: 28, flexShrink: 0 }}>
                          R{r.round}
                        </span>
                        <div className="flex-1 flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 16 }}>CT</span>
                            <div className="flex-1 h-2 rounded-full" style={{ background: "#142135" }}>
                              <div className="h-2 rounded-full transition-all" style={{
                                width: `${(r.ct_spend / maxSpend) * 100}%`,
                                background: "#2D7DD2",
                              }} />
                            </div>
                            <span className="stat-number" style={{ fontSize: "0.7rem", color: "#8BA7CC", width: 40, textAlign: "right" }}>
                              ${r.ct_spend}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 16 }}>T</span>
                            <div className="flex-1 h-2 rounded-full" style={{ background: "#142135" }}>
                              <div className="h-2 rounded-full transition-all" style={{
                                width: `${(r.t_spend / maxSpend) * 100}%`,
                                background: "#C9A227",
                              }} />
                            </div>
                            <span className="stat-number" style={{ fontSize: "0.7rem", color: "#8BA7CC", width: 40, textAlign: "right" }}>
                              ${r.t_spend}
                            </span>
                          </div>
                        </div>
                        <span style={{
                          color: r.winner === "CT" ? "#2D7DD2" : "#C9A227",
                          fontSize: "0.72rem", fontWeight: 600, width: 24, textAlign: "right",
                        }}>
                          {r.winner}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
