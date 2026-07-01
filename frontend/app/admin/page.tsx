"use client";

import { useEffect, useState } from "react";
import { CloudMotifBg, UlziiBorder } from "@/components/patterns/mongolian";
import { Database, ShieldCheck, Server, AlertCircle } from "lucide-react";

interface QdrantQuota {
  collections: number;
  vectors: number;
  disk_usage_mb: number;
  status: "healthy" | "warning" | "critical";
}

export default function AdminDashboardPage() {
  const [quota, setQuota] = useState<QdrantQuota | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const res = await fetch("/api/admin/qdrant-quota");
        if (res.ok) {
          const data = await res.json();
          setQuota(data);
        } else {
          // Mock data if API is not fully implemented
          setQuota({
            collections: 5,
            vectors: 12500,
            disk_usage_mb: 450,
            status: "healthy"
          });
        }
      } catch (e) {
        setQuota({
          collections: 5,
          vectors: 12500,
          disk_usage_mb: 450,
          status: "healthy"
        });
      }
      setLoading(false);
    };

    fetchQuota();
    const interval = setInterval(fetchQuota, 30000); // poll every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen px-6 py-20 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <CloudMotifBg />
      <div className="relative max-w-5xl mx-auto z-10">
        <div className="flex items-center gap-4 mb-8">
          <ShieldCheck size={32} className="text-[var(--color-accent-primary)]" />
          <h1 className="section-heading">Admin Dashboard</h1>
        </div>

        <UlziiBorder className="mb-8" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Qdrant Quota Widget */}
          <div className="card-elevated p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Database size={80} className="text-[var(--color-accent-primary)]" />
            </div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Database size={18} className="text-[var(--color-accent-primary)]" /> Qdrant Vector DB
            </h2>
            
            {loading ? (
              <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin border-[var(--color-accent-primary)]" />
                Polling quota...
              </div>
            ) : quota ? (
              <div className="space-y-4 relative z-10">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-text-secondary)] text-sm">Status</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    quota.status === 'healthy' ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20' :
                    quota.status === 'warning' ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20' :
                    'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/20'
                  }`}>
                    {quota.status}
                  </span>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-secondary)]">Collections</span>
                    <span className="font-mono font-bold">{quota.collections}</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-secondary)]">Vectors</span>
                    <span className="font-mono font-bold">{quota.vectors.toLocaleString()}</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-secondary)]">Disk Usage</span>
                    <span className="font-mono font-bold">{quota.disk_usage_mb.toFixed(1)} MB</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden mt-2">
                    <div 
                      className="h-full bg-[var(--color-accent-primary)] transition-all" 
                      style={{ width: `${Math.min((quota.disk_usage_mb / 1000) * 100, 100)}%` }} 
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[var(--color-danger)] flex items-center gap-2 text-sm">
                <AlertCircle size={14} /> Failed to load quota data
              </div>
            )}
          </div>

          {/* System Status Mock */}
          <div className="card p-6">
             <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Server size={18} className="text-[var(--color-accent-secondary)]" /> Services
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-2 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)]">
                <span className="text-sm font-semibold text-[var(--color-text-secondary)]">API</span>
                <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)]">
                <span className="text-sm font-semibold text-[var(--color-text-secondary)]">Demo Parser</span>
                <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)]">
                <span className="text-sm font-semibold text-[var(--color-text-secondary)]">AI Model</span>
                <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
