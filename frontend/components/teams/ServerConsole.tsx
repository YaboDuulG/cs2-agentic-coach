"use client";

import { Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Notice, Skeleton, toast } from "@/components/ui";
import { HttpError, useSendConsole, useServerConsole } from "@/lib/api/hooks";

const SUGGESTIONS = ["status", "changelevel de_mirage", "bot_kick", "mp_restartgame 1", "sv_cheats 1"];

/**
 * Raw RCON through DatHost's console endpoint. One command per submit; the
 * server's console tail comes back with every response and refreshes while
 * the panel is open. Natural-language commands went with the old chat route.
 */
export function ServerConsole({ serverId, enabled }: { serverId: string; enabled: boolean }) {
  const log = useServerConsole(serverId, enabled);
  const send = useSendConsole(serverId);
  const [command, setCommand] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const tailRef = useRef<HTMLDivElement>(null);

  const lines = log.data?.lines ?? [];
  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [lines.length]);

  async function run(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed || send.isPending) return;
    setSent((s) => [...s.slice(-19), trimmed]);
    setCommand("");
    try {
      await send.mutateAsync(trimmed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The command did not go through.");
    }
  }

  if (!enabled) {
    return (
      <p className="mt-3 text-[12px]" style={{ color: "var(--color-text-3)" }}>
        The console opens once the server is running.
      </p>
    );
  }

  const err = log.error;
  if (err instanceof HttpError && [409, 503].includes(err.status)) {
    return (
      <Notice tone="warning" className="mt-3">
        {err.message}
      </Notice>
    );
  }

  return (
    <div className="mt-4">
      <div
        ref={tailRef}
        className="surface-2 num max-h-64 overflow-y-auto px-3 py-2 text-[12px] leading-5"
        role="log"
        aria-live="polite"
        aria-label="Server console"
      >
        {log.isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : lines.length === 0 ? (
          <span style={{ color: "var(--color-text-3)" }}>Console is quiet. Run a command below.</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {l}
            </div>
          ))
        )}
        {err ? <div style={{ color: "var(--color-danger)" }}>{err.message}</div> : null}
      </div>

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(command);
        }}
      >
        <Input
          id="console-command"
          mono
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="rcon command, e.g. status"
          maxLength={200}
          aria-label="Console command"
          list="console-history"
          autoComplete="off"
        />
        <datalist id="console-history">
          {[...new Set([...sent, ...SUGGESTIONS])].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Button type="submit" variant="secondary" loading={send.isPending} disabled={!command.trim()}>
          <Terminal size={14} aria-hidden="true" />
          Run
        </Button>
      </form>
      <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
        Runs on the server itself; no rcon_password needed here.
      </p>
    </div>
  );
}
