"use client";

import React, { useEffect, useRef, useState } from "react";
import CS2PlanningBoard, { CS2PlanningBoardRef } from "../../components/CS2PlanningBoard";
import { DiscordSyncSidebar } from "../../components/stratbook/DiscordSyncSidebar";
import { Save, Bot } from "lucide-react";

interface Team {
  team_id: string;
  name: string;
}

export default function StratbookPage() {
  const boardRef = useRef<CS2PlanningBoardRef>(null);
  const [map, setMap] = useState("de_mirage");
  const [title, setTitle] = useState("");
  const [critique, setCritique] = useState("");
  const [isCritiquing, setIsCritiquing] = useState(false);

  // The page is user-strategy-only; team strats appear when a team is selectable.
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/teams")
      .then((r) => (r.ok ? r.json() : []))
      .then((t) => {
        if (Array.isArray(t)) {
          setTeams(t);
          setTeamId((prev) => prev ?? t[0]?.team_id ?? null);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!boardRef.current) return;
    const state = boardRef.current.exportStrategy();
    
    // In a real app, this would use the logged-in user's ID
    const userId = "test-user-123"; 

    try {
      const res = await fetch("/api/stratbook/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          map_name: state.map,
          title: title || "My Custom Strategy",
          strategy_json: JSON.stringify(state)
        })
      });
      if (res.ok) {
        alert("Strategy saved successfully!");
      } else {
        alert("Failed to save strategy.");
      }
    } catch (e) {
      console.error(e);
      alert("Error saving strategy.");
    }
  };

  const handleCritique = async () => {
    if (!boardRef.current) return;
    const state = boardRef.current.exportStrategy();
    
    setIsCritiquing(true);
    setCritique("");

    try {
      const res = await fetch("/api/stratbook/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_name: state.map,
          strategy_json: JSON.stringify(state)
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCritique(data.critique || "No critique generated.");
      } else {
        setCritique("Error: Failed to fetch critique from backend.");
      }
    } catch (e) {
      console.error(e);
      setCritique("Error: Something went wrong while requesting critique.");
    } finally {
      setIsCritiquing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
              DemoSage Stratbook
            </h1>
            <p className="text-slate-400 mt-1">Design and validate your custom CS2 setups.</p>
          </div>

          <div className="flex items-center gap-4">
            <input 
              type="text" 
              placeholder="Strategy Title..." 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button 
              onClick={handleSave}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Save size={16} /> Save Strat
            </button>
            <button 
              onClick={handleCritique}
              disabled={isCritiquing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Bot size={16} /> {isCritiquing ? "Critiquing..." : "Get AI Critique"}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-2">
            <CS2PlanningBoard ref={boardRef} selectedMap={map} />
          </div>

          <div className="col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 h-full flex flex-col">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Bot className="text-indigo-400" /> Tactical AI Coach
              </h2>
              <div className="flex-1 bg-slate-950 rounded-lg border border-slate-800 p-4 overflow-y-auto">
                {isCritiquing ? (
                  <div className="flex items-center justify-center h-full text-slate-500 animate-pulse">
                    Analyzing strategy...
                  </div>
                ) : critique ? (
                  <div className="prose prose-invert max-w-none text-sm">
                    {/* Render basic markdown text (for production use react-markdown) */}
                    <pre className="whitespace-pre-wrap font-sans">{critique}</pre>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-500">
                    <p>Draw your strategy and hit &quot;Get AI Critique&quot; to receive feedback based on professional playbooks.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Team stratbook — server-synced strats with Discord status. */}
        {teams.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Team Stratbook</h2>
              <select
                value={teamId ?? ""}
                onChange={(e) => setTeamId(e.target.value || null)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              >
                {teams.map((t) => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <DiscordSyncSidebar teamId={teamId} />
          </section>
        )}

      </div>
    </div>
  );
}
