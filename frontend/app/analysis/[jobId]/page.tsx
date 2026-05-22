"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { CheckCircle, AlertCircle, Clock, Crosshair, TrendingUp, Layers, Brain, Lightbulb, Shield, Zap } from "lucide-react";

type JobStatus = "queued" | "processing" | "done" | "failed";

interface KillEvent {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
  killer_team?: string;
  attacker_x?: number;
  attacker_y?: number;
  victim_x?: number;
  victim_y?: number;
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

interface Coaching {
  summary: string;
  key_findings: string[];
  economy_analysis: string;
  tactical_recommendations: { title: string; detail: string }[];
  strongest_area: string;
  weakest_area: string;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued:     { label: "Queued",    color: "#8BA7CC", icon: <Clock size={16} /> },
  processing: { label: "Parsing…", color: "#2D7DD2", icon: <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} /> },
  done:       { label: "Complete", color: "#22D3A0", icon: <CheckCircle size={16} /> },
  failed:     { label: "Failed",   color: "#FF4D6D", icon: <AlertCircle size={16} /> },
};

// --- Kill Heatmap Component ---
function KillHeatmap({ kills }: { kills: KillEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kills.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0D1825";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath(); ctx.moveTo((W / 10) * i, 0); ctx.lineTo((W / 10) * i, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (H / 10) * i); ctx.lineTo(W, (H / 10) * i); ctx.stroke();
    }

    // Normalise coords
    const xs = kills.flatMap(k => [k.attacker_x ?? 0, k.victim_x ?? 0]).filter(Boolean);
    const ys = kills.flatMap(k => [k.attacker_y ?? 0, k.victim_y ?? 0]).filter(Boolean);
    if (!xs.length) return;

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 30;

    const toCanvas = (x: number, y: number) => ({
      cx: pad + ((x - minX) / rangeX) * (W - 2 * pad),
      cy: pad + ((y - minY) / rangeY) * (H - 2 * pad),
    });

    // Draw kill lines + dots
    for (const k of kills) {
      if (!k.attacker_x || !k.victim_x) continue;
      const a = toCanvas(k.attacker_x, k.attacker_y ?? 0);
      const v = toCanvas(k.victim_x, k.victim_y ?? 0);
      const isCT = k.killer_team === "CT";

      // Line
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(v.cx, v.cy);
      ctx.strokeStyle = isCT ? "rgba(45,125,210,0.15)" : "rgba(201,162,39,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Attacker dot (killer)
      ctx.beginPath();
      ctx.arc(a.cx, a.cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isCT ? "#2D7DD2" : "#C9A227";
      ctx.fill();

      // Victim dot (X)
      ctx.beginPath();
      ctx.arc(v.cx, v.cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,77,109,0.7)";
      ctx.fill();
    }

    // Legend
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.fillStyle = "#2D7DD2"; ctx.beginPath(); ctx.arc(16, H - 20, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8BA7CC"; ctx.fillText("CT kill", 26, H - 16);
    ctx.fillStyle = "#C9A227"; ctx.beginPath(); ctx.arc(90, H - 20, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8BA7CC"; ctx.fillText("T kill", 100, H - 16);
    ctx.fillStyle = "#FF4D6D"; ctx.beginPath(); ctx.arc(152, H - 20, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8BA7CC"; ctx.fillText("victim", 162, H - 16);
  }, [kills]);

  return (
    <div className="card p-6">
      <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>Kill Positions</h2>
      <canvas
        ref={canvasRef}
        width={560}
        height={400}
        className="w-full rounded-xl"
        style={{ border: "1px solid #1E3A5F" }}
      />
    </div>
  );
}

// --- AI Coaching Panel ---
function CoachingPanel({ matchId }: { matchId: string }) {
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [status, setStatus] = useState<"loading" | "pending" | "ready" | "error">("loading");

  useEffect(() => {
    let stopped = false;
    async function poll() {
      for (let i = 0; i < 20; i++) {
        if (stopped) return;
        try {
          const res = await fetch(`/api/coaching/${matchId}`);
          const data = await res.json();
          if (data.status === "ready") {
            setCoaching(data.coaching);
            setStatus("ready");
            return;
          }
          setStatus("pending");
        } catch { setStatus("error"); return; }
        await new Promise(r => setTimeout(r, 5000));
      }
      setStatus("error");
    }
    poll();
    return () => { stopped = true; };
  }, [matchId]);

  return (
    <div className="card p-6" style={{ borderColor: "rgba(201,162,39,0.2)", background: "rgba(201,162,39,0.02)" }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)" }}>
          <Brain size={20} color="#C9A227" />
        </div>
        <div>
          <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>Great Khan Analysis</h2>
          <p style={{ color: "#8BA7CC", fontSize: "0.75rem" }}>AI tactical coaching powered by Gemini</p>
        </div>
      </div>

      {status === "loading" || status === "pending" ? (
        <div className="flex items-center gap-3 py-6">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C9A227", borderTopColor: "transparent" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>The Khan is studying your demo…</span>
        </div>
      ) : status === "error" ? (
        <p style={{ color: "#4A6A8A", fontSize: "0.875rem" }}>Coaching not available for this match yet.</p>
      ) : coaching ? (
        <div className="space-y-5">
          <p style={{ color: "#C4CEDD", lineHeight: 1.7 }}>{coaching.summary}</p>

          <div>
            <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Key Findings</h3>
            <ul className="space-y-2">
              {coaching.key_findings.map((f, i) => (
                <li key={i} className="flex gap-2" style={{ fontSize: "0.875rem", color: "#C4CEDD" }}>
                  <span style={{ color: "#C9A227", flexShrink: 0 }}>›</span> {f}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Economy</h3>
            <p style={{ color: "#8BA7CC", fontSize: "0.875rem", lineHeight: 1.6 }}>{coaching.economy_analysis}</p>
          </div>

          <div>
            <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Recommendations</h3>
            <div className="space-y-3">
              {coaching.tactical_recommendations.map((r, i) => (
                <div key={i} className="flex gap-3">
                  <Lightbulb size={14} color="#C9A227" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <span style={{ color: "#F0F4FF", fontWeight: 600, fontSize: "0.875rem" }}>{r.title}: </span>
                    <span style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>{r.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-xl p-4" style={{ background: "rgba(34,211,160,0.06)", border: "1px solid rgba(34,211,160,0.15)" }}>
              <div className="flex items-center gap-2 mb-2"><Shield size={14} color="#22D3A0" /><span style={{ color: "#22D3A0", fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>Strongest Area</span></div>
              <p style={{ color: "#C4CEDD", fontSize: "0.8rem" }}>{coaching.strongest_area}</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: "rgba(255,77,109,0.06)", border: "1px solid rgba(255,77,109,0.15)" }}>
              <div className="flex items-center gap-2 mb-2"><Zap size={14} color="#FF4D6D" /><span style={{ color: "#FF4D6D", fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>Fix First</span></div>
              <p style={{ color: "#C4CEDD", fontSize: "0.8rem" }}>{coaching.weakest_area}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Round Timeline ---
function RoundTimeline({ rounds }: { rounds: RoundResult[] }) {
  return (
    <div className="card p-6">
      <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>Round Timeline</h2>
      <div className="flex flex-wrap gap-1.5">
        {rounds.map((r) => (
          <div
            key={r.round}
            title={`R${r.round} — ${r.winner} wins | CT $${r.ct_spend.toLocaleString()} vs T $${r.t_spend.toLocaleString()}`}
            className="flex flex-col items-center gap-1"
          >
            <div
              className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
              style={{
                background: r.winner === "CT" ? "rgba(45,125,210,0.25)" : "rgba(201,162,39,0.25)",
                border: `1px solid ${r.winner === "CT" ? "rgba(45,125,210,0.5)" : "rgba(201,162,39,0.5)"}`,
                color: r.winner === "CT" ? "#2D7DD2" : "#C9A227",
                fontSize: "0.6rem",
              }}
            >
              {r.winner === "CT" ? "C" : "T"}
            </div>
            <span style={{ color: "#4A6A8A", fontSize: "0.55rem", fontFamily: "JetBrains Mono" }}>{r.round}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(45,125,210,0.4)", border: "1px solid #2D7DD2" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.72rem" }}>CT win: {rounds.filter(r => r.winner === "CT").length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(201,162,39,0.4)", border: "1px solid #C9A227" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.72rem" }}>T win: {rounds.filter(r => r.winner === "T").length}</span>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---
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
        } catch { /* continue */ }
        await new Promise(r => setTimeout(r, 3000));
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

        {(status === "queued" || status === "processing") && (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-6"
              style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
            <h2 className="heading-display mb-3" style={{ fontSize: "1.4rem" }}>
              The Khan is reading your demo…
            </h2>
            <p style={{ color: "#8BA7CC" }}>Parsing rounds, kills, and utility. This takes 30–90 seconds.</p>
          </div>
        )}

        {status === "failed" && (
          <div className="card p-10 text-center" style={{ borderColor: "rgba(255,77,109,0.3)" }}>
            <AlertCircle size={40} color="#FF4D6D" className="mx-auto mb-4" />
            <h2 className="heading-display mb-2" style={{ fontSize: "1.3rem" }}>Parse Failed</h2>
            <p style={{ color: "#8BA7CC" }}>{result?.error ?? "Unknown error. Please try uploading again."}</p>
          </div>
        )}

        {status === "done" && result && (
          <div className="space-y-6 animate-fade-in-up">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { icon: Layers,    label: "Rounds",   value: result.total_rounds ?? 0 },
                { icon: Crosshair, label: "Kills",    value: result.total_kills ?? 0 },
                { icon: TrendingUp,label: "Grenades", value: result.total_grenades ?? 0 },
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

            {/* AI Coaching Panel */}
            <CoachingPanel matchId={jobId} />

            {/* Round Timeline */}
            {result.rounds && result.rounds.length > 0 && (
              <RoundTimeline rounds={result.rounds} />
            )}

            {/* Kill Heatmap */}
            {result.kills && result.kills.length > 0 && (
              <KillHeatmap kills={result.kills} />
            )}

            {/* Kill Feed */}
            {result.kills && result.kills.length > 0 && (
              <div className="card p-6">
                <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>Kill Feed</h2>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {result.kills.slice(0, 50).map((k, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "#142135" }}>
                      <div className="flex items-center gap-3">
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem", fontFamily: "JetBrains Mono" }}>R{k.round}</span>
                        <span style={{ color: "#22D3A0", fontWeight: 500, fontSize: "0.875rem" }}>{k.killer}</span>
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem" }}>killed</span>
                        <span style={{ color: "#FF4D6D", fontSize: "0.875rem" }}>{k.victim}</span>
                      </div>
                      <span style={{ color: "#8BA7CC", fontSize: "0.75rem", fontFamily: "JetBrains Mono" }}>{k.weapon}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Economy */}
            {result.rounds && result.rounds.length > 0 && (
              <div className="card p-6">
                <h2 className="heading-display mb-4" style={{ fontSize: "1.1rem" }}>Economy by Round</h2>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {result.rounds.map((r) => {
                    const maxSpend = Math.max(r.ct_spend, r.t_spend, 1);
                    return (
                      <div key={r.round} className="flex items-center gap-4">
                        <span style={{ color: "#4A6A8A", fontSize: "0.75rem", fontFamily: "JetBrains Mono", width: 28, flexShrink: 0 }}>R{r.round}</span>
                        <div className="flex-1 flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 16 }}>CT</span>
                            <div className="flex-1 h-2 rounded-full" style={{ background: "#142135" }}>
                              <div className="h-2 rounded-full" style={{ width: `${(r.ct_spend / maxSpend) * 100}%`, background: "#2D7DD2" }} />
                            </div>
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 40, textAlign: "right" }}>${r.ct_spend}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 16 }}>T</span>
                            <div className="flex-1 h-2 rounded-full" style={{ background: "#142135" }}>
                              <div className="h-2 rounded-full" style={{ width: `${(r.t_spend / maxSpend) * 100}%`, background: "#C9A227" }} />
                            </div>
                            <span style={{ color: "#8BA7CC", fontSize: "0.7rem", width: 40, textAlign: "right" }}>${r.t_spend}</span>
                          </div>
                        </div>
                        <span style={{ color: r.winner === "CT" ? "#2D7DD2" : "#C9A227", fontSize: "0.72rem", fontWeight: 600, width: 24, textAlign: "right" }}>{r.winner}</span>
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
