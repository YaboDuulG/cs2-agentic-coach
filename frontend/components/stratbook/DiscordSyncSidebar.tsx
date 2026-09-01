"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { api, StratStatus, StratSummary } from "@/lib/api/client";
import { useStrats, useStratTransition } from "@/lib/api/hooks";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface DiscordSyncSidebarProps {
  teamId: string | null;
}

const STATUS_STYLES: Record<StratStatus, { color: string; strike?: boolean }> = {
  DRAFT: { color: "var(--color-text-muted)" },
  IN_REVIEW: { color: "var(--color-warning)" },
  ACTIVE: { color: "var(--color-success)" },
  ARCHIVED: { color: "var(--color-text-muted)", strike: true },
};

function StatusChip({ status }: { status: StratStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        s.strike && "line-through",
      )}
      style={{
        color: s.color,
        background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${s.color} 30%, transparent)`,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

type BindState = "idle" | "loading" | "copied" | "error";

/**
 * Team strats with live Discord sync status. useStrats refetches every 15s,
 * so Discord-side approvals/revisions show up without a manual refresh.
 */
export function DiscordSyncSidebar({ teamId }: DiscordSyncSidebarProps) {
  const strats = useStrats(teamId);
  const transition = useStratTransition(teamId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bindState, setBindState] = useState<BindState>("idle");
  const [bindError, setBindError] = useState("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const transitioningId = transition.isPending ? transition.variables?.stratId : null;

  const doTransition = (stratId: string, status: StratStatus) => {
    transition.mutate({ stratId, status });
  };

  const mintBindCode = async (stratId: string) => {
    setBindState("loading");
    setBindError("");
    try {
      const { code } = await api.stratBindCode(stratId);
      await navigator.clipboard.writeText(code);
      setBindState("copied");
    } catch (err) {
      setBindState("error");
      setBindError(
        err instanceof Error && /403/.test(err.message)
          ? "Only the team owner can mint bind codes."
          : "Could not mint a bind code.",
      );
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setBindState("idle"), 2500);
  };

  const selected = (strats.data ?? []).find((s) => s.id === selectedId) ?? null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: "var(--color-text-primary)" }}
        >
          Team strats
        </h3>
        <span
          className="flex items-center gap-1.5 text-[10px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-success)" }}
            aria-hidden="true"
          />
          live · syncs every 15s
        </span>
      </div>

      {!teamId ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Select a team to see its stratbook.
        </p>
      ) : strats.isPending ? (
        <div className="flex items-center gap-2 py-4">
          <Spinner size={16} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Loading strats…
          </span>
        </div>
      ) : strats.isError ? (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          Failed to load team strats.
        </p>
      ) : (strats.data ?? []).length === 0 ? (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          No strats yet for this team.
        </p>
      ) : (
        <ul className="space-y-2">
          {(strats.data ?? []).map((strat: StratSummary) => {
            const busy = transitioningId === strat.id;
            const isSelected = selectedId === strat.id;
            return (
              <li
                key={strat.id}
                className="cursor-pointer rounded-md border px-3 py-2.5 transition-colors"
                style={{
                  background: isSelected ? "var(--color-accent-soft)" : "var(--color-bg-secondary)",
                  borderColor: isSelected
                    ? "var(--color-border-strong)"
                    : "var(--color-border-primary)",
                }}
                onClick={() => setSelectedId(strat.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {strat.title}
                  </span>
                  <StatusChip status={strat.status} />
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="text-[10px]"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}
                  >
                    {strat.map_name} · {strat.side} · {strat.buy_type.replace(/_/g, " ")}
                  </span>
                  <span
                    className="ml-auto flex items-center gap-1 text-[10px]"
                    style={{
                      color: strat.discord_thread_id
                        ? "var(--color-success)"
                        : "var(--color-text-muted)",
                    }}
                    title={
                      strat.discord_thread_id
                        ? `Discord thread ${strat.discord_thread_id}`
                        : undefined
                    }
                  >
                    {strat.discord_thread_id ? <Link2 size={10} /> : <Link2Off size={10} />}
                    {strat.discord_thread_id ? "synced to Discord" : "not synced"}
                  </span>
                </div>
                {(strat.status === "IN_REVIEW" || strat.status === "ACTIVE") && (
                  <div className="mt-2 flex gap-2">
                    {strat.status === "IN_REVIEW" && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          doTransition(strat.id, "ACTIVE");
                        }}
                      >
                        {busy ? "Approving…" : "Approve"}
                      </Button>
                    )}
                    {strat.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          doTransition(strat.id, "ARCHIVED");
                        }}
                      >
                        {busy ? "Archiving…" : "Archive"}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {transition.isError && (
        <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>
          Transition failed — the strat may have changed state in Discord.
        </p>
      )}

      {selected && (
        <div
          className="mt-3 border-t pt-3"
          style={{ borderColor: "var(--color-border-primary)" }}
        >
          <Button
            size="sm"
            variant="secondary"
            disabled={bindState === "loading"}
            onClick={() => mintBindCode(selected.id)}
          >
            {bindState === "loading" ? (
              <>
                <Spinner size={12} /> Minting…
              </>
            ) : bindState === "copied" ? (
              <>
                <Check size={12} /> Code copied
              </>
            ) : (
              <>
                <Copy size={12} /> Discord bind code
              </>
            )}
          </Button>
          {bindState === "error" && (
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--color-danger)" }}>
              {bindError}
            </p>
          )}
          <p className="mt-1.5 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            Paste the code in your Discord server to bind this team&apos;s stratbook.
          </p>
        </div>
      )}
    </Card>
  );
}
