"use client";

import { useUser } from "@clerk/nextjs";
import { useState } from "react";
import Navbar from "@/components/Navbar";

export default function SettingsPage() {
  const { user, isLoaded } = useUser();
  const [saving, setSaving] = useState(false);
  
  if (!isLoaded || !user) return <div className="p-8 text-white">Loading...</div>;

  const publicMetadata = user.publicMetadata || {};
  const useSkins = !!publicMetadata.use_skins_plugin;

  async function toggleSkins() {
    setSaving(true);
    try {
      await user?.update({
        publicMetadata: {
          ...publicMetadata,
          use_skins_plugin: !useSkins,
        },
      });
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  return (
    <main className="min-h-screen bg-[#080E1A]">
      <Navbar />
      <div className="mx-auto max-w-4xl p-8 text-white">
        <h1 className="mb-8 font-cinzel text-3xl font-bold text-[#E8C37D]">Settings</h1>
        
        <div className="rounded-xl border border-white/10 bg-[#0F172A] p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-semibold">Practice Server Preferences</h2>
          
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-4">
            <div>
              <h3 className="font-semibold text-white">Weapon Skins Plugin</h3>
              <p className="text-sm text-slate-400">
                Automatically load the CounterStrikeSharp weapon paints plugin when spinning up a practice server.
                You can configure your skins directly in-game using `!ws`.
              </p>
            </div>
            
            <button
              onClick={toggleSkins}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                useSkins ? "bg-[#2D7DD2]" : "bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  useSkins ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
