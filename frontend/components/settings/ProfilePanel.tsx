"use client";

import { useUser } from "@clerk/nextjs";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, CardHeader, FieldError, Input, Label, Notice, Skeleton, toast } from "@/components/ui";
import { useSteamProfile } from "@/lib/api/hooks";

// Accepts SteamID64, profile URLs, SteamID3 "[U:1:N]" and SteamID2 "STEAM_X:Y:Z".
function normalizeSteamId(raw: string): string {
  const s = raw.trim();
  const m64 = s.match(/(7656\d{13})/);
  if (m64) return m64[1];
  const BASE = BigInt("76561197960265728"); // tsconfig targets below ES2020: no bigint literals
  const id3 = s.match(/\[?U:1:(\d+)\]?/i);
  if (id3) return (BigInt(id3[1]) + BASE).toString();
  const id2 = s.match(/^STEAM_\d+:([01]):(\d+)$/i);
  if (id2) return (BigInt(id2[2]) * BigInt(2) + BigInt(id2[1]) + BASE).toString();
  return s;
}

const isVanity = (s: string) => /steamcommunity\.com\/id\//i.test(s);

export function ProfilePanel({ steamParam, reason }: { steamParam: string | null; reason: string | null }) {
  const { user } = useUser();
  const steamId = (user?.unsafeMetadata?.steam_id as string | undefined) ?? "";
  const profile = useSteamProfile(steamId);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (steamParam === "linked") toast.success("Steam account linked.");
    if (steamParam === "error") toast.error(reason === "claimed_id" ? "Steam returned an unexpected account id." : "Steam could not verify the sign-in. Try again.");
  }, [steamParam, reason]);

  async function save() {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      let id = "";
      if (isVanity(input)) {
        const res = await fetch(`/api/steam/resolve?url=${encodeURIComponent(input.trim())}`);
        const data = await res.json();
        if (!res.ok || !data.steamid) throw new Error(data.error ?? "Could not resolve that profile URL.");
        id = data.steamid;
      } else {
        id = normalizeSteamId(input);
        if (!/^7656\d{13}$/.test(id)) throw new Error("That doesn't look like a Steam ID. Paste your profile URL or SteamID64.");
      }
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, steam_id: id } });
      setEditing(false);
      setInput("");
      toast.success("Steam ID saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    if (!user) return;
    await user.update({ unsafeMetadata: { ...user.unsafeMetadata, steam_id: "" } });
    toast("Steam account unlinked.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Steam" description="Personal coaching uses this to know which player is you." />
        {steamId && !editing ? (
          <div className="space-y-3">
            <div className="surface-2 flex items-center gap-3 p-3">
              {profile.isLoading ? (
                <Skeleton className="h-10 w-10 rounded-lg" />
              ) : profile.data ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.data.avatarmedium} alt="" className="h-10 w-10 rounded-lg" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{profile.data?.personaname ?? "Linked"}</p>
                <p className="num truncate text-[12px]" style={{ color: "var(--color-text-3)" }}>
                  {steamId}
                </p>
              </div>
              {profile.data?.profileurl ? (
                <a href={profile.data.profileurl} target="_blank" rel="noreferrer" className="link text-[12px]" aria-label="Open Steam profile">
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button variant="ghost" size="sm" onClick={unlink}>
                Unlink
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!steamId ? (
              <Notice tone="warning">Not linked. Personal reports can only cover the whole lobby until it is.</Notice>
            ) : null}
            <Button asChild>
              <a href="/api/steam/login">Sign in through Steam</a>
            </Button>
            <div>
              <Label htmlFor="steam-id" hint="SteamID64, profile URL, [U:1:…] or STEAM_0:…">
                Or enter it manually
              </Label>
              <div className="flex gap-2">
                <Input id="steam-id" mono value={input} onChange={(e) => setInput(e.target.value)} placeholder="steamcommunity.com/profiles/7656…" />
                <Button onClick={save} loading={saving} disabled={!input.trim()}>
                  Save
                </Button>
                {editing ? (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              <FieldError>{error}</FieldError>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Account" description="Name, email and password live with Clerk." />
        <p className="text-sm">
          <span style={{ color: "var(--color-text-2)" }}>Signed in as </span>
          <span className="font-semibold">{user?.primaryEmailAddress?.emailAddress ?? user?.username ?? "—"}</span>
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-3">
          <Link href="/settings/account">Manage account</Link>
        </Button>
      </Card>
    </div>
  );
}
