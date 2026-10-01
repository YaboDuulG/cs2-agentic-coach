"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Notice, toast } from "@/components/ui";
import { useMatchNotes, useSaveNotes } from "@/lib/api/hooks";

/**
 * Parse failed: the parser's message and a way to try another demo.
 * Coaching failed: the reason and a re-run. Nothing else renders on the page
 * in either state.
 */
export function FailedScreen({ kind, matchId, message }: { kind: "parse" | "coaching"; matchId: string; message?: string | null }) {
  const qc = useQueryClient();
  const notes = useMatchNotes(kind === "coaching" ? matchId : null);
  const save = useSaveNotes(matchId);

  const rerun = () => {
    save.mutate(notes.data?.notes ?? "", {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["job", matchId] });
        toast.success("Coaching queued again. This page updates on its own.");
      },
      onError: (e) => toast.error(e.message || "Could not re-run coaching."),
    });
  };

  const title = kind === "parse" ? "We couldn't parse this demo" : "Coaching didn't finish";
  const fallback =
    kind === "parse"
      ? "The parser stopped before it could read the rounds. Corrupt or truncated demos do this; a fresh download usually fixes it."
      : "The coach stopped before the report was ready. A re-run uses the same parsed rounds, so it only takes a minute or two.";

  return (
    <div className="enter mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-5 py-12">
      <div>
        <p className="eyebrow mb-2">Debrief</p>
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
      </div>
      <Notice tone="danger" title={kind === "parse" ? "Parser message" : "Reason"}>
        {message?.trim() || fallback}
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        {kind === "parse" ? (
          <Button asChild>
            <Link href="/">Upload a different demo</Link>
          </Button>
        ) : (
          <Button onClick={rerun} loading={save.isPending} disabled={notes.isLoading}>
            Re-run coaching
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/matches">Back to matches</Link>
        </Button>
      </div>
    </div>
  );
}
