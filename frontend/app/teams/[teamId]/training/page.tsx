"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { TRAINING_MODES, trainingModeLabel } from "@/components/teams/trainingModes";
import { hoursLabel, isServerRunning, SERVER_MAPS, SERVER_REGIONS } from "@/components/teams/util";
import { Badge, Button, Card, CardHeader, Label, Notice, PageHeader, Select, SkeletonRows, Stat, Tabs, toast, type TabItem } from "@/components/ui";
import { HttpError, useCreateServer, useCreateTrainingSession, useServerModes, useTeamServers, useTrainingSessions } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

type View = "modes" | "stats";
const VIEWS: TabItem<View>[] = [
  { key: "modes", label: "Modes" },
  { key: "stats", label: "Statistics" },
];

type LaunchError = {
  tone: "danger" | "warning";
  title: string;
  body: string;
  serverId?: string;
};

/** Training: pick a mode, start a private server, control it on the next page. */
export default function TrainingPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const router = useRouter();
  const modes = useServerModes();
  const servers = useTeamServers(teamId);
  const stats = useTrainingSessions(teamId);
  const createServer = useCreateServer(teamId);
  const createSession = useCreateTrainingSession(teamId);
  const [view, setView] = useState<View>("modes");
  const [mode, setMode] = useState("");
  const [region, setRegion] = useState<"eu" | "na">("eu");
  const [map, setMap] = useState(SERVER_MAPS[0]!.value);
  const [launchError, setLaunchError] = useState<LaunchError | null>(null);

  const available = useMemo(() => new Set((modes.data?.modes ?? []).map((m) => m.key)), [modes.data]);
  const running = (servers.data ?? []).find((s) => isServerRunning(s.status)) ?? null;
  const busy = createServer.isPending || createSession.isPending;
  const reason = !mode
    ? "Pick a mode below to start."
    : running
      ? "A server is already running for this team."
      : modes.data?.update_window_active
        ? "Valve is updating CS2; servers are paused."
        : null;

  async function start() {
    if (!mode || busy) return;
    setLaunchError(null);
    try {
      const server = await createServer.mutateAsync({ mode, region, map });
      try {
        await createSession.mutateAsync({
          server_id: server.id,
          mode,
          map_name: map,
          region,
        });
      } catch (e) {
        // The server is up either way; the session is only the log entry.
        toast.error(e instanceof Error ? `Server started, but the session was not logged: ${e.message}` : "Server started, but the session was not logged.");
      }
      router.push(`/teams/${teamId}/servers/${server.id}`);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      const message = e instanceof Error ? e.message : "Could not start the server.";
      if (status === 402)
        setLaunchError({
          tone: "danger",
          title: "Server hosting is out of credits",
          body: message,
        });
      else if (status === 400 && /active server/i.test(message)) {
        await servers.refetch();
        const live = (servers.data ?? []).find((s) => isServerRunning(s.status));
        setLaunchError({
          tone: "warning",
          title: "A server is already running",
          body: "Open it or stop it before starting another.",
          serverId: live?.id,
        });
      } else if (status === 503)
        setLaunchError({
          tone: "warning",
          title: "Servers are paused",
          body: message,
        });
      else
        setLaunchError({
          tone: "danger",
          title: "Could not start the server",
          body: message,
        });
    }
  }

  return (
    <div>
      <PageHeader
        back={
          <Link href={`/teams/${teamId}`} className="link">
            ← Team
          </Link>
        }
        eyebrow="Practice servers"
        title="Training"
        description="Ten modes on a private server. Pick one, pick a map, start."
      />

      {modes.data?.update_window_active ? (
        <Notice tone="warning" title="CS2 is updating" className="mb-6">
          {modes.data.update_detail || "Servers cannot start until Valve's update finishes."}
        </Notice>
      ) : null}

      {running ? (
        <Notice
          tone="info"
          title={`${trainingModeLabel(running.mode)} is ${running.status === "active" ? "running" : "booting"}`}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/teams/${teamId}/servers/${running.id}`}>Open server</Link>
            </Button>
          }
          className="mb-6"
        >
          One server per team at a time. Stop it to start a different mode.
        </Notice>
      ) : null}

      <Card className="mb-6">
        <CardHeader title="Launch" description={mode ? `${trainingModeLabel(mode)} on ${mapLabel(map)}.` : "Choose a mode from the grid; region and map are yours to set."} />
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="launch-mode">Mode</Label>
            <Select id="launch-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Pick a mode</option>
              {TRAINING_MODES.map((m) => (
                <option key={m.key} value={m.key} disabled={modes.isSuccess && !available.has(m.key)}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="launch-region">Region</Label>
            <Select id="launch-region" value={region} onChange={(e) => setRegion(e.target.value === "na" ? "na" : "eu")}>
              {SERVER_REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="launch-map">Map</Label>
            <Select id="launch-map" value={map} onChange={(e) => setMap(e.target.value)}>
              {SERVER_MAPS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={start} loading={busy} disabled={Boolean(reason)} title={reason ?? undefined}>
            Start session
          </Button>
        </div>
        {reason ? (
          <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
            {reason}
          </p>
        ) : null}
        {launchError ? (
          <Notice
            tone={launchError.tone}
            title={launchError.title}
            className="mt-4"
            action={
              launchError.serverId ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/teams/${teamId}/servers/${launchError.serverId}`}>Open the running server</Link>
                </Button>
              ) : undefined
            }
          >
            {launchError.body}
          </Notice>
        ) : null}
      </Card>

      <Tabs items={VIEWS} value={view} onChange={setView} label="Training sections" className="mb-6" />

      {view === "modes" ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Training modes">
          {TRAINING_MODES.map((m) => {
            const selected = m.key === mode;
            const unavailable = modes.isSuccess && !available.has(m.key);
            const detail = modes.data?.modes.find((x) => x.key === m.key);
            return (
              <li key={m.key} className="flex">
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={unavailable}
                  onClick={() => setMode(selected ? "" : m.key)}
                  className="surface w-full overflow-hidden text-left transition-[border-color] duration-(--dur-fast) hover:border-(--color-line-strong) disabled:opacity-50"
                  style={selected ? { borderColor: "var(--color-accent)" } : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.image} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base">{m.label}</h3>
                      {selected ? <Badge tone="accent">Selected</Badge> : null}
                      {unavailable ? <Badge>Unavailable</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                      {m.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                      {detail?.game_mode ? <Badge mono>{detail.game_mode}</Badge> : null}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : stats.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sessions" value={stats.data?.total_sessions ?? 0} />
            <Stat label="Hours trained" value={hoursLabel(stats.data?.total_seconds ?? 0)} />
            <Stat label="This week" value={stats.data?.sessions_this_week ?? 0} />
            <Stat label="Favourite mode" value={<span className="font-body text-base">{trainingModeLabel(stats.data?.favourite_mode)}</span>} />
          </div>
          <Card>
            <CardHeader title="Sessions" description="Newest first." />
            {(stats.data?.sessions.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
                No sessions yet. Start one above and it shows up here.
              </p>
            ) : (
              <ul className="space-y-2">
                {stats.data!.sessions.map((s) => (
                  <li key={s.id} className="surface-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="font-semibold">{trainingModeLabel(s.mode)}</span>
                    <span style={{ color: "var(--color-text-2)" }}>{mapLabel(s.map_name)}</span>
                    <Badge mono>{s.region}</Badge>
                    <span className="num ml-auto text-[12px]" style={{ color: "var(--color-text-3)" }}>
                      {s.duration_seconds != null ? `${Math.round(s.duration_seconds / 60)} min · ` : s.ended_at ? "" : "in progress · "}
                      {relativeTime(s.started_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
