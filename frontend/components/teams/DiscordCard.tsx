"use client";

import { useRef, useState } from "react";
import { CopyButton } from "@/components/teams/CopyButton";
import { Button, Card, CardHeader, toast } from "@/components/ui";
import type { StratSummary } from "@/lib/api/client";
import { HttpError, useStratBindCode } from "@/lib/api/hooks";

/** Discord: mint a bind code for the selected strat so its thread syncs here. */
export function DiscordCard({ strat, isOwner }: { strat: StratSummary | null; isOwner: boolean }) {
  const bind = useStratBindCode();
  const [code, setCode] = useState<{ stratId: string; code: string } | null>(null);
  const codeRef = useRef<HTMLSpanElement>(null);

  const shown = code && strat && code.stratId === strat.id ? code.code : null;
  const reason = !isOwner ? "Only the captain can mint bind codes." : !strat ? "Pick a strat first." : null;

  async function getCode() {
    if (!strat) return;
    try {
      const res = await bind.mutateAsync(strat.id);
      setCode({ stratId: strat.id, code: res.code });
    } catch (e) {
      if (e instanceof HttpError && e.status === 503) toast.error("Discord is not configured on the server.");
      else if (e instanceof HttpError && e.status === 403) toast.error("Only the captain can mint bind codes.");
      else toast.error(e instanceof Error ? e.message : "Could not get a bind code.");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Discord"
        description={
          strat?.discord_thread_id ? (
            <>
              Bound to thread <span className="num">{strat.discord_thread_id}</span>.
            </>
          ) : (
            "Bind a strat to a Discord thread to discuss and approve it there."
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={getCode} loading={bind.isPending} disabled={Boolean(reason)} title={reason ?? undefined}>
          Get bind code
        </Button>
        {reason ? (
          <span className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
            {reason}
          </span>
        ) : null}
      </div>
      {shown ? (
        <div className="surface-2 mt-4 px-4 py-3">
          <p className="eyebrow">Bind code</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span ref={codeRef} className="num text-lg font-semibold tracking-wider">
              {shown}
            </span>
            <CopyButton text={shown} selectRef={codeRef} />
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-2)" }}>
            In Discord run <span className="num">/strat bind {shown}</span> inside the thread for this strat.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
