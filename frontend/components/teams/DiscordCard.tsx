"use client";

import { useRef, useState } from "react";
import { CopyButton } from "@/components/teams/CopyButton";
import { Badge, Button, Card, CardHeader, Modal, Notice, SkeletonRows, toast } from "@/components/ui";
import { HttpError, useTeamBindCode, useTeamDiscord, useUnbindDiscord } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";

/**
 * Discord: one bind per team. Bound from inside a channel group, every
 * channel named after a map gets that map's strats as threads; this card
 * shows that mapping so the captain can see what the bot sees.
 */
export function DiscordCard({ teamId, isOwner }: { teamId: string; isOwner: boolean }) {
  const status = useTeamDiscord(teamId);
  const bind = useTeamBindCode(teamId);
  const unbind = useUnbindDiscord(teamId);
  const [code, setCode] = useState<string | null>(null);
  const [unbindOpen, setUnbindOpen] = useState(false);
  const commandRef = useRef<HTMLElement>(null);

  async function getCode() {
    try {
      setCode((await bind.mutateAsync()).code);
    } catch (e) {
      if (e instanceof HttpError && e.status === 503) toast.error("Discord is not configured on the server yet.");
      else toast.error(e instanceof Error ? e.message : "Could not get a bind code.");
    }
  }

  async function onUnbind() {
    try {
      await unbind.mutateAsync();
      setUnbindOpen(false);
      setCode(null);
      toast.success("Discord unbound. Threads already in Discord are untouched.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unbind Discord.");
    }
  }

  const s = status.data;
  const command = code ? `/strat bind code:${code}` : null;

  return (
    <Card>
      <CardHeader
        title="Discord"
        description="Strats open as threads in your map channels; the team approves them there."
        actions={s ? <Badge tone={s.bound ? "good" : "neutral"}>{s.bound ? "Connected" : "Not connected"}</Badge> : null}
      />

      {status.isLoading ? (
        <SkeletonRows rows={2} />
      ) : status.isError || !s ? (
        <Notice tone="warning">Discord status is unavailable right now.</Notice>
      ) : !s.configured ? (
        <Notice tone="warning" title="Not set up on the server yet">
          The Discord app&apos;s public key, bot token and bind secret are not all configured, so binding is switched off.
        </Notice>
      ) : s.bound ? (
        <div className="space-y-3">
          {s.category_id ? (
            s.channels.length > 0 ? (
              <ul className="space-y-1.5" aria-label="Map channels">
                {s.channels.map((c) => (
                  <li key={c.channel_id} className="surface-2 flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="num truncate">#{c.name}</span>
                    <span style={{ color: "var(--color-text-2)" }}>{mapLabel(c.map_name)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
                Reading the channel group. Channels named after a map (mirage, de-inferno, dust2) appear here in a few seconds.
              </p>
            )
          ) : (
            <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
              Single-channel mode: every strat goes to the channel where the bind ran. To use one channel per map, unbind and bind again from
              a channel inside your map channel group.
            </p>
          )}
          <p className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
            {s.category_id ? "A map without a channel goes to the channel where the bind ran. " : ""}
            Run <span className="num">/strat channels</span> in Discord to refresh.
          </p>
          {isOwner ? (
            <Button size="sm" variant="ghost" onClick={() => setUnbindOpen(true)}>
              Unbind
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: "var(--color-text-2)" }}>
            <li>Put one channel per map in a channel group and name each after its map.</li>
            <li>Get the bind code below.</li>
            <li>Run the command in any channel of that group.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={getCode} loading={bind.isPending} disabled={!isOwner}>
              Get bind code
            </Button>
            {!isOwner ? (
              <span className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
                Only the captain can bind Discord.
              </span>
            ) : null}
          </div>
          {command ? (
            <div className="surface-2 px-4 py-3">
              <p className="eyebrow">Run in Discord</p>
              <code ref={commandRef} className="num mt-1 block break-all text-sm font-semibold">
                {command}
              </code>
              <div className="mt-2">
                <CopyButton text={command} selectRef={commandRef} label="Copy command" />
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Modal
        open={unbindOpen}
        onClose={() => setUnbindOpen(false)}
        title="Unbind Discord?"
        description="New strats stop syncing until you bind again. Threads already in Discord are not deleted."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setUnbindOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onUnbind} loading={unbind.isPending}>
            Unbind
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
