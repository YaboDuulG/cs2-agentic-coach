"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser, useAuth } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { CheckCircle, ExternalLink, Loader2, AlertCircle } from "lucide-react";

interface LinkedStatus {
  steam: string | null;
  faceit: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [status, setStatus] = useState<LinkedStatus>({ steam: null, faceit: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Poll linked account status from API
  useEffect(() => {
    if (!isLoaded || !user) return;
    const fetchStatus = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/proxy/oauth/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (e) {
        setError("Could not load account status.");
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, [isLoaded, user, searchParams]);

  const handleConnect = (provider: "steam" | "faceit") => {
    window.location.href = `/api/proxy/oauth/${provider}/login`;
  };

  const bothLinked = status.steam && status.faceit;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-16"
      style={{ background: "var(--gradient-hero)" }}
    >
      {/* Header */}
      <motion.div
        className="text-center mb-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1
          className="section-heading mb-3"
          style={{ color: "var(--color-text-primary)" }}
        >
          Connect Your Accounts
        </h1>
        <p style={{ color: "var(--color-text-secondary)", maxWidth: 440, margin: "0 auto", lineHeight: 1.7 }}>
          Link Steam and FACEIT once. DemoSage will automatically find and analyze your recent matches
          — no manual uploads required.
        </p>
      </motion.div>

      {/* Cards */}
      <div className="w-full max-w-md space-y-4">
        {/* Steam */}
        <motion.div
          className="card p-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                style={{ background: "rgba(45, 125, 210, 0.15)", border: "1px solid rgba(45, 125, 210, 0.3)" }}
              >
                🎮
              </div>
              <div>
                <p className="font-semibold" style={{ color: "var(--color-text-primary)" }}>Steam</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {status.steam ? `ID: ${status.steam}` : "CS2 Matchmaking demos"}
                </p>
              </div>
            </div>
            {loading ? (
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
            ) : status.steam ? (
              <CheckCircle size={20} style={{ color: "var(--color-success)" }} />
            ) : (
              <button
                className="btn-primary text-sm"
                onClick={() => handleConnect("steam")}
              >
                Connect
              </button>
            )}
          </div>
        </motion.div>

        {/* FACEIT */}
        <motion.div
          className="card p-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                style={{ background: "rgba(255, 85, 0, 0.12)", border: "1px solid rgba(255, 85, 0, 0.25)" }}
              >
                ⚡
              </div>
              <div>
                <p className="font-semibold" style={{ color: "var(--color-text-primary)" }}>FACEIT</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {status.faceit ? `ID: ${status.faceit}` : "FACEIT match history (optional)"}
                </p>
              </div>
            </div>
            {loading ? (
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
            ) : status.faceit ? (
              <CheckCircle size={20} style={{ color: "var(--color-success)" }} />
            ) : (
              <button
                className="btn-secondary text-sm"
                onClick={() => handleConnect("faceit")}
              >
                Connect
              </button>
            )}
          </div>
        </motion.div>

        {/* Skip / Continue */}
        <motion.div
          className="flex flex-col items-center gap-3 pt-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          {error && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-danger)" }}>
              <AlertCircle size={14} />{error}
            </div>
          )}
          <button
            className="btn-primary w-full"
            onClick={() => router.push("/dashboard")}
            disabled={!isLoaded}
          >
            {bothLinked ? "Go to Dashboard →" : "Continue without linking →"}
          </button>
          {!bothLinked && (
            <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
              You can always link accounts later from your profile settings.
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
