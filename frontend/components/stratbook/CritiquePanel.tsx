"use client";

import { Lock } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { UpgradeModal } from "@/components/paywall/UpgradeModal";
import { Button, Card, CardHeader, EmptyState, Notice, Skeleton } from "@/components/ui";
import { useEntitlements } from "@/lib/api/hooks";

export interface CritiquePanelProps {
  /** The critique text, once `useCritique` has returned one. */
  text: string | null;
  isPending: boolean;
  error: string | null;
  /** The board has something on it worth critiquing. */
  canRequest: boolean;
  onRequest: () => void;
}

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

/** The coach replies in light markdown: headings, bullets, bold. No library. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case "h":
      return (
        <h4 key={i} className="mt-4 text-sm first:mt-0">
          {inline(b.text)}
        </h4>
      );
    case "p":
      return (
        <p key={i} className="text-sm" style={{ color: "var(--color-text-2)" }}>
          {inline(b.text)}
        </p>
      );
    case "ul":
    case "ol": {
      const Tag = b.kind;
      return (
        <Tag key={i} className={b.kind === "ul" ? "list-disc space-y-1 pl-5 text-sm" : "num list-decimal space-y-1 pl-5 text-sm"}>
          {b.items.map((item, j) => (
            <li key={j} style={{ color: "var(--color-text-2)" }}>
              {inline(item)}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

export function CritiquePanel({ text, isPending, error, canRequest, onRequest }: CritiquePanelProps) {
  const ents = useEntitlements();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const blocks = useMemo(() => (text ? parseBlocks(text) : []), [text]);

  // The critique route is not server-gated today: Free users get the whole
  // text back. This lock is a display-only teaser (first paragraph, then the
  // plan chip) until the server sends a redacted shape of its own.
  const locked = ents.data ? !ents.data.entitlements.includes("full_coaching") : false;
  const teaserIndex = blocks.findIndex((b) => b.kind === "p");
  const teaser = locked ? blocks.slice(0, Math.max(0, teaserIndex) + 1) : blocks;

  return (
    <Card className="flex flex-col">
      <CardHeader eyebrow="Coach" title="Critique" description="Measured against pro playbooks for this map." />

      {isPending ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-4 h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : error ? (
        <Notice
          tone="danger"
          title="The critique did not come back"
          action={
            <Button size="sm" variant="secondary" onClick={onRequest} disabled={!canRequest}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : blocks.length === 0 ? (
        <EmptyState
          title="No critique yet"
          description={canRequest ? "Ask the coach to read what you have sketched." : "Sketch a setup first: paths, player pins, utility."}
          action={
            <Button size="sm" onClick={onRequest} disabled={!canRequest}>
              Get critique
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {teaser.map(renderBlock)}
          {locked ? (
            <div className="surface-2 mt-3 flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <Lock size={16} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">The full critique is on Solo Pro</p>
                  <p className="text-[13px]" style={{ color: "var(--color-text-2)" }}>
                    Timings, utility fixes and the pro references for this setup.
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => setUpgradeOpen(true)}>
                See plans
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} tierNeeded="SOLO_PRO" />
    </Card>
  );
}
