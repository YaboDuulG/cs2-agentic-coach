"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Users, Plus, LogIn, Copy, Check, ChevronRight } from "lucide-react";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";

interface Team {
  team_id: string;
  name: string;
  invite_code: string;
  is_owner: boolean;
  created_at: string;
  member_count: number;
}

export default function TeamsPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !user) return;
    fetch("/api/teams")
      .then(r => r.json())
      .then(data => { setTeams(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user, isLoaded]);

  async function createTeam() {
    if (!teamName.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create team");
      setTeams(prev => [...prev, { ...data, is_owner: true, member_count: 1, created_at: new Date().toISOString() }]);
      setTeamName(""); setShowCreate(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    setSaving(false);
  }

  async function joinTeam() {
    if (!inviteCode.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      router.push(`/teams/${data.team_id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    setSaving(false);
  }


  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  if (!isLoaded) return null;
  if (!user) {
    router.push("/sign-in");
    return null;
  }

  return (
    <div className="min-h-screen px-6 py-16 relative" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <SoyomboIcon size={36} color="#C9A227" />
            <div>
              <h1 className="heading-display" style={{ fontSize: "1.8rem" }}>My Teams</h1>
              <p style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>Share analyses and train together</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setShowJoin(true); setShowCreate(false); setError(null); }}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-all hover:bg-white/5"
              style={{ borderColor: "#1E3A5F", color: "#8BA7CC" }}
            >
              <LogIn size={16} /> Join Team
            </button>
            <button
              onClick={() => { setShowCreate(true); setShowJoin(false); setError(null); }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              style={{ background: "linear-gradient(135deg, #1B4F8A, #2D7DD2)", color: "#fff" }}
            >
              <Plus size={16} /> Create Team
            </button>
          </div>
        </div>

        <UlziiBorder className="mb-8" />

        {/* Create / Join modal */}
        {(showCreate || showJoin) && (
          <div className="card p-6 mb-8" style={{ borderColor: "rgba(45,125,210,0.4)" }}>
            <h3 className="heading-display mb-4" style={{ fontSize: "1rem" }}>
              {showCreate ? "Create a New Team" : "Join by Invite Code"}
            </h3>
            {showCreate ? (
              <div className="flex gap-3">
                <input
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createTeam()}
                  placeholder="Team name (e.g. Vitality Academy)"
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
                  style={{ background: "#0D1825", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                />
                <button
                  onClick={createTeam}
                  disabled={saving || !teamName.trim()}
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
                  style={{ background: "#2D7DD2", color: "#fff" }}
                >
                  {saving ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowCreate(false)} style={{ color: "#4A6A8A", fontSize: "0.875rem" }}>Cancel</button>
              </div>
            ) : (
              <div className="flex gap-3">
                <input
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && joinTeam()}
                  placeholder="8-character code (e.g. A3F9BC12)"
                  maxLength={8}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none font-mono uppercase"
                  style={{ background: "#0D1825", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                />
                <button
                  onClick={joinTeam}
                  disabled={saving || inviteCode.length < 8}
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
                  style={{ background: "#2D7DD2", color: "#fff" }}
                >
                  {saving ? "Joining…" : "Join"}
                </button>
                <button onClick={() => setShowJoin(false)} style={{ color: "#4A6A8A", fontSize: "0.875rem" }}>Cancel</button>
              </div>
            )}
            {error && <p style={{ color: "#FF4D6D", fontSize: "0.8rem", marginTop: 8 }}>{error}</p>}
          </div>
        )}

        {/* Teams list */}
        {loading ? (
          <div className="flex items-center gap-3 py-12">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
            <span style={{ color: "#8BA7CC" }}>Loading teams…</span>
          </div>
        ) : teams.length === 0 ? (
          <div className="card p-12 text-center">
            <Users size={48} color="#1E3A5F" className="mx-auto mb-4" />
            <h2 className="heading-display mb-2" style={{ fontSize: "1.3rem" }}>No teams yet</h2>
            <p style={{ color: "#8BA7CC", marginBottom: 20 }}>Create a team and invite your squad to share match analyses.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"
              style={{ background: "#2D7DD2", color: "#fff" }}
            >
              <Plus size={16} /> Create your first team
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {teams.map(team => (
              <div
                key={team.team_id}
                className="card p-5 flex items-center justify-between group hover:border-[#2D7DD2]/40 transition-colors cursor-pointer"
                onClick={() => router.push(`/teams/${team.team_id}`)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "rgba(45,125,210,0.1)", border: "1px solid rgba(45,125,210,0.2)" }}>
                    <Users size={20} color="#2D7DD2" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span style={{ color: "#F0F4FF", fontWeight: 600 }}>{team.name}</span>
                      {team.is_owner && (
                        <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: "rgba(201,162,39,0.1)", color: "#C9A227", border: "1px solid rgba(201,162,39,0.2)" }}>Owner</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span style={{ color: "#4A6A8A", fontSize: "0.75rem" }}>{team.member_count} member{team.member_count !== 1 ? "s" : ""}</span>
                      <button
                        onClick={e => { e.stopPropagation(); copyCode(team.invite_code); }}
                        className="flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:bg-white/5"
                        style={{ color: "#4A6A8A", fontSize: "0.72rem", fontFamily: "JetBrains Mono" }}
                      >
                        {copiedCode === team.invite_code ? <Check size={10} color="#22D3A0" /> : <Copy size={10} />}
                        {copiedCode === team.invite_code ? "Copied!" : team.invite_code}
                      </button>
                    </div>
                  </div>
                </div>
                <ChevronRight size={18} color="#4A6A8A" className="group-hover:text-white transition-colors" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
