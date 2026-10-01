"use client";

import { useUser } from "@clerk/nextjs";
import { ArrowRight, Link2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MatchRow } from "@/components/matches/MatchRow";
import { Button, Card, CardHeader, EmptyState, Notice, PageHeader, SkeletonRows } from "@/components/ui";
import { DropZone } from "@/components/upload/DropZone";
import { UploadModal } from "@/components/upload/UploadModal";
import { useEntitlements, useMatches } from "@/lib/api/hooks";
import { longDate } from "@/lib/format";
import { useDemoUpload } from "@/lib/upload/useDemoUpload";

/** Home: get the next demo in, get back to the last one. */
export function Home() {
  const { user } = useUser();
  const steamId = (user?.unsafeMetadata?.steam_id as string | undefined) ?? "";
  const meta = (user?.publicMetadata ?? {}) as { uploadsThisMonth?: number; plan?: string };
  const ents = useEntitlements();
  const matches = useMatches("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<{ mode: "personal" } | undefined>(undefined);
  const [carriedFile, setCarriedFile] = useState<File | null>(null);
  const upload = useDemoUpload();

  const tier = ents.data?.tier ?? "FREE";
  const limit = tier === "FREE" ? 2 : tier === "SOLO_PRO" ? 10 : null;
  const used = meta.uploadsThisMonth ?? 0;
  const quota = limit === null ? "Unlimited uploads" : `${Math.max(0, limit - used)} of ${limit} uploads left this month`;
  const planName = tier === "TEAM" ? "Team" : tier === "SOLO_PRO" ? "Solo Pro" : "Free";
  const expiry = ents.data?.source === "trial" && ents.data.current_period_end ? ` · trial ends ${longDate(ents.data.current_period_end)}` : "";

  const recent = (matches.data ?? []).slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow="Home"
        title={`Welcome back${user?.firstName ? `, ${user.firstName}` : ""}`}
        description={`${planName} · ${quota}${expiry}`}
        actions={
          <Button
            onClick={() => {
              setModalPreset(undefined);
              setModalOpen(true);
            }}
          >
            Upload a demo
          </Button>
        }
      />

      {!steamId ? (
        <Notice
          tone="warning"
          title="Link your Steam ID"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/settings">Link Steam</Link>
            </Button>
          }
          className="mb-6"
        >
          Personal coaching needs to know which player is you.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Upload" description="Drop a demo to start; you choose who it is for on the next step." />
          <DropZone
            compact
            state={upload.state}
            onCancel={upload.cancel}
            onFile={(file) => {
              // The drop zone on Home is a shortcut past the picker for personal
              // uploads. Without a linked Steam ID (or before Clerk has loaded
              // the user) the file is carried into the modal instead of dropped.
              if (steamId) {
                upload.upload(file, { teamId: null, isRecon: false });
              } else {
                setModalPreset(undefined);
                setCarriedFile(file);
                setModalOpen(true);
              }
            }}
          />
          <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
            Dropping here uploads as <strong>Coach me</strong>. For a team or scouting demo use the Upload button.
          </p>
        </Card>

        <Card>
          <CardHeader
            title="Recent matches"
            actions={
              <Link href="/matches" className="link flex items-center gap-1 text-sm">
                All matches <ArrowRight size={14} aria-hidden="true" />
              </Link>
            }
          />
          {matches.isLoading ? (
            <SkeletonRows rows={4} />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No matches yet"
              description="Your first upload starts here. A debrief takes a few minutes."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setModalPreset(undefined);
                    setModalOpen(true);
                  }}
                >
                  Upload a demo
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {recent.map((m) => (
                <MatchRow key={m.match_id} m={m} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {tier !== "TEAM" ? (
        <Card className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <h2 className="text-base">{tier === "FREE" ? "Your reports stop at the headline" : "Bring your roster"}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                {tier === "FREE"
                  ? "Solo Pro unlocks every finding with round and tick references, pro benchmarks and drills."
                  : "Team adds team analysis, opponent scouting, practice servers and the stratbook with Discord sync, for one price per ESEA season."}
              </p>
            </div>
            <Button asChild variant="secondary">
              <Link href="/billing">
                <Link2 size={14} aria-hidden="true" /> See plans
              </Link>
            </Button>
          </div>
        </Card>
      ) : null}

      <UploadModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCarriedFile(null);
        }}
        preset={modalPreset}
        initialFile={carriedFile}
      />
    </div>
  );
}
