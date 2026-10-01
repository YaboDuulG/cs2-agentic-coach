"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, FieldError, Input, Label, Modal, Select, SkeletonRows, Textarea, toast } from "@/components/ui";
import { SERVER_MAPS } from "@/components/teams/util";
import { useAddTeamStrategy, useTeamStrategies } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

/** The RAG rows the coach reads: notes ingested from Discord or added here. */
export function IngestedStrategies({ teamId }: { teamId: string }) {
  const strategies = useTeamStrategies(teamId);
  const add = useAddTeamStrategy(teamId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [map, setMap] = useState(SERVER_MAPS[0]!.value);
  const [side, setSide] = useState<"T" | "CT">("T");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");

  const rows = (strategies.data ?? []).slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const valid = title.trim().length > 0 && summary.trim().length > 0;

  async function submit() {
    try {
      await add.mutateAsync({
        title: title.trim(),
        map_name: map,
        side,
        summary: summary.trim(),
        steps: steps
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success("Strategy added. The coach can reference it now.");
      setOpen(false);
      setTitle("");
      setSummary("");
      setSteps("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the strategy.");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Ingested from Discord"
        description="Written strats the coach can cite in chat."
        actions={
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Add strategy
          </Button>
        }
      />
      {strategies.isLoading ? (
        <SkeletonRows rows={2} />
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
          Nothing ingested yet. Post a strat in your bound Discord channel or add one here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id} className="surface-2 px-3 py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold">
                  {s.side ? <Badge tone={s.side === "CT" ? "ct" : "t"}>{s.side}</Badge> : null}
                  <span className="min-w-0 flex-1 truncate">{s.title || "Untitled"}</span>
                  <span className="text-[12px] font-normal" style={{ color: "var(--color-text-3)" }}>
                    {mapLabel(s.map_name)} · <span className="num">{relativeTime(s.created_at)}</span>
                  </span>
                </summary>
                <div className="mt-2 text-sm" style={{ color: "var(--color-text-2)" }}>
                  {s.summary ? <p>{s.summary}</p> : null}
                  {s.steps?.length ? (
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      {s.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                  {s.author ? (
                    <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                      by {s.author}
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add strategy" description="A written strat the coach can reference. One step per line.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="strategy-title">Title</Label>
            <Input id="strategy-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A split through connector" maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="strategy-map">Map</Label>
              <Select id="strategy-map" value={map} onChange={(e) => setMap(e.target.value)}>
                {SERVER_MAPS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="strategy-side">Side</Label>
              <Select id="strategy-side" value={side} onChange={(e) => setSide(e.target.value === "CT" ? "CT" : "T")}>
                <option value="T">T</option>
                <option value="CT">CT</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="strategy-summary">Summary</Label>
            <Textarea id="strategy-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What the strat does and when to call it." />
          </div>
          <div>
            <Label htmlFor="strategy-steps" hint="one per line">
              Steps
            </Label>
            <Textarea id="strategy-steps" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"Smoke CT from top mid\nFlash over connector\nEntry through jungle"} />
          </div>
          <FieldError>{add.isError ? (add.error as Error).message : null}</FieldError>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={add.isPending} disabled={!valid}>
              Add
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
