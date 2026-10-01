"use client";

import { AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge, ModeBadge } from "@/components/ui";
import type { MatchMode } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

export interface MatchRowData {
  match_id: string;
  map: string | null;
  status: string | null;
  created_at: string | null;
  mode: MatchMode | string;
  uploader?: string | null;
}

function statusOf(status: string | null | undefined): "done" | "failed" | "working" {
  const s = (status ?? "").toLowerCase();
  if (["done", "complete", "parsed"].includes(s)) return "done";
  if (s === "failed") return "failed";
  return "working";
}

/** One match in any list: map, mode, state, age. Click opens the debrief. */
export function MatchRow({ m, showUploader }: { m: MatchRowData; showUploader?: boolean }) {
  const state = statusOf(m.status);
  return (
    <Link
      href={`/analysis/${m.match_id}`}
      className="surface-2 flex items-center gap-3 px-4 py-3 transition-[border-color] duration-[var(--dur-fast)] hover:border-(--color-line-strong)"
    >
      <span
        aria-hidden="true"
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: state === "done" ? "var(--color-good)" : state === "failed" ? "var(--color-danger)" : "var(--color-accent)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{mapLabel(m.map)}</span>
          <ModeBadge mode={m.mode} />
          {state === "working" ? (
            <Badge tone="accent" icon={<Loader2 size={11} className="animate-spin" aria-hidden="true" />}>
              Processing
            </Badge>
          ) : null}
          {state === "failed" ? (
            <Badge tone="danger" icon={<AlertCircle size={11} aria-hidden="true" />}>
              Failed
            </Badge>
          ) : null}
        </div>
        <p className="num mt-0.5 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          {relativeTime(m.created_at)}
          {showUploader && m.uploader ? ` · ${m.uploader}` : ""}
        </p>
      </div>
      <ChevronRight size={16} style={{ color: "var(--color-text-3)" }} aria-hidden="true" />
    </Link>
  );
}
