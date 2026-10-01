"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/teams/CopyButton";
import { ServerConsole } from "@/components/teams/ServerConsole";
import { trainingModeLabel } from "@/components/teams/trainingModes";
import { expiresIn, isServerRunning } from "@/components/teams/util";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, SkeletonRows, toast } from "@/components/ui";
import { useTeamServers, useTerminateServer, useTrainingSessions } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";

// In-game chat commands the practice plugin answers; no API behind them.
const PRACTICE_COMMANDS = [
  { cmd: ".setup", desc: "Loads the practice layout, configs and cheats." },
  { cmd: ".noclip", desc: "Toggles fly mode to check utility landings." },
  { cmd: ".grenade", desc: "Gives a full pack of smokes, flashes and molotovs." },
  { cmd: ".rethrow", desc: "Rethrows your last grenade." },
  { cmd: ".clear", desc: "Clears smokes and molotov fire immediately." },
  { cmd: ".bot", desc: "Spawns a bot at your crosshair." },
  { cmd: ".kick", desc: "Kicks all bots." },
  { cmd: ".spawn", desc: "Teleports you back to spawn." },
];

/** One running server: how to connect, how long it lasts, how to stop it. */
export default function ServerPage({ params }: { params: Promise<{ teamId: string; serverId: string }> }) {
  const { teamId, serverId } = use(params);
  const router = useRouter();
  const servers = useTeamServers(teamId);
  const sessions = useTrainingSessions(teamId);
  const terminate = useTerminateServer(teamId);
  const [showRcon, setShowRcon] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const connectRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const server = (servers.data ?? []).find((s) => s.id === serverId) ?? null;
  const session = (sessions.data?.sessions ?? []).find((s) => s.server_id === serverId) ?? null;

  async function stop() {
    try {
      await terminate.mutateAsync(serverId);
      toast.success("Server stopped.");
      router.push(`/teams/${teamId}/training`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop the server.");
    }
  }

  const back = (
    <Link href={`/teams/${teamId}/training`} className="link">
      ← Training
    </Link>
  );

  if (servers.isLoading) {
    return (
      <div>
        <PageHeader back={back} eyebrow="Practice server" title="Server" />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (!server) {
    return (
      <div>
        <PageHeader back={back} eyebrow="Practice server" title="Server" />
        <EmptyState
          title="This server is gone"
          description="It was stopped or expired. Start a new session from the training page."
          action={
            <Button asChild variant="secondary">
              <Link href={`/teams/${teamId}/training`}>Back to training</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const live = isServerRunning(server.status);
  const booting = server.status === "booting";
  const stripe = booting ? "var(--color-accent)" : live ? "var(--color-good)" : "var(--color-text-3)";
  const statusLabel = booting ? "Booting" : live ? "Running" : server.status;
  const remaining = expiresIn(server.expires_at, now);
  const connect = server.ip_address ? `connect ${server.ip_address}; password ${server.server_password}` : null;

  return (
    <div>
      <PageHeader
        back={back}
        eyebrow="Practice server"
        title={trainingModeLabel(server.mode)}
        description={session ? `${mapLabel(session.map_name)} · ${session.region.toUpperCase()}` : undefined}
        actions={
          live ? (
            <Button variant="danger" onClick={() => setStopOpen(true)}>
              Stop server
            </Button>
          ) : null
        }
      />

      <div className="surface mb-6 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" style={{ borderLeft: `4px solid ${stripe}` }}>
        <div className="flex items-center gap-2">
          <Badge tone={booting ? "accent" : live ? "good" : "neutral"}>{statusLabel}</Badge>
          {booting ? (
            <span className="text-sm" style={{ color: "var(--color-text-2)" }}>
              Provisioning; the address appears when the host answers.
            </span>
          ) : null}
        </div>
        <div className="sm:ml-auto">
          <span className="eyebrow">Expires in</span>{" "}
          <span className="num text-sm font-semibold" style={{ color: remaining === "expired" ? "var(--color-danger)" : "var(--color-text)" }}>
            {remaining || "—"}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Connect" description="Paste into the CS2 console." />
          {connect ? (
            <>
              <code ref={connectRef} className="surface-2 num block break-all px-3 py-2 text-sm">
                {connect}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={connect} selectRef={connectRef} label="Copy connect string" />
                {server.ip_address ? <CopyButton text={server.ip_address} label="Copy address" variant="ghost" /> : null}
              </div>
            </>
          ) : (
            <SkeletonRows rows={1} />
          )}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt style={{ color: "var(--color-text-3)" }}>Address</dt>
            <dd className="num">{server.ip_address ?? "assigning…"}</dd>
            <dt style={{ color: "var(--color-text-3)" }}>Password</dt>
            <dd className="num">{server.server_password}</dd>
            <dt style={{ color: "var(--color-text-3)" }}>Mode</dt>
            <dd>{trainingModeLabel(server.mode)}</dd>
            <dt style={{ color: "var(--color-text-3)" }}>Map</dt>
            <dd>{session ? mapLabel(session.map_name) : "—"}</dd>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Console" description="Run server commands from here, or from the in-game console with rcon_password then rcon <command>." />
          <div className="flex flex-wrap items-center gap-2">
            <code className="surface-2 num px-3 py-2 text-sm">{showRcon ? server.rcon_password : "•".repeat(Math.min(16, server.rcon_password.length || 8))}</code>
            <Button size="sm" variant="ghost" onClick={() => setShowRcon((v) => !v)} aria-pressed={showRcon}>
              {showRcon ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              {showRcon ? "Hide" : "Reveal"}
            </Button>
            <CopyButton text={`rcon_password ${server.rcon_password}`} label="Copy rcon_password" />
          </div>
          <ServerConsole serverId={server.id} enabled={live && !booting} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Chat commands" description="Type these in the in-game text chat while practising." />
          <ul className="grid gap-2 sm:grid-cols-2">
            {PRACTICE_COMMANDS.map((c) => (
              <li key={c.cmd} className="surface-2 flex items-center gap-3 px-3 py-2 text-sm">
                <code className="num font-semibold" style={{ color: "var(--color-focus)" }}>
                  {c.cmd}
                </code>
                <span className="min-w-0 flex-1" style={{ color: "var(--color-text-2)" }}>
                  {c.desc}
                </span>
                <CopyButton text={c.cmd} label="Copy" variant="ghost" />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal open={stopOpen} onClose={() => setStopOpen(false)} title="Stop this server?" description="Everyone on it is disconnected and the session ends." size="sm">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStopOpen(false)}>
            Keep running
          </Button>
          <Button variant="danger" onClick={stop} loading={terminate.isPending}>
            Stop server
          </Button>
        </div>
      </Modal>
    </div>
  );
}
