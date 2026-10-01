"use client";

import { Save, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { type BoardJson, MAPS, emptyBoard, isBoardEmpty, parseBoard } from "@/components/stratbook/boardJson";
import { CritiquePanel } from "@/components/stratbook/CritiquePanel";
import { PlanningBoard } from "@/components/stratbook/PlanningBoard";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, SkeletonRows, toast } from "@/components/ui";
import { type UserStrategy, useCritique, useSaveUserStrategy, useUserStrategies } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

/** Stratbook: sketch a setup and get it critiqued against pro playbooks. */
export default function StratbookPage() {
  const [map, setMap] = useState(MAPS[0].id);
  const [board, setBoard] = useState<BoardJson>(() => emptyBoard());
  const [title, setTitle] = useState("");
  const [loadedId, setLoadedId] = useState<number | null>(null);

  const strategies = useUserStrategies();
  const save = useSaveUserStrategy();
  const critique = useCritique();

  const canRequest = !isBoardEmpty(board);

  // A sketch belongs to its map: switching maps starts over.
  const changeMap = (next: string) => {
    if (next === map) return;
    setMap(next);
    setBoard(emptyBoard());
    setLoadedId(null);
    critique.reset();
  };

  const onBoardChange = useCallback((json: BoardJson) => setBoard(json), []);

  const requestCritique = () => {
    if (!canRequest) return;
    critique.mutate(
      { map_name: map, strategy_json: JSON.stringify(board) },
      { onError: (e) => toast.error(`Couldn't get a critique: ${(e as Error).message}`) },
    );
  };

  const saveStrat = () => {
    const name = title.trim() || `${mapLabel(map)} setup`;
    save.mutate(
      { map_name: map, title: name, strategy_json: JSON.stringify(board) },
      {
        onSuccess: (res) => {
          setLoadedId(res.id);
          if (!title.trim()) setTitle(name);
          toast.success(`Saved "${name}" to your stratbook.`);
        },
        onError: (e) => toast.error(`Couldn't save the strat: ${(e as Error).message}`),
      },
    );
  };

  const loadStrat = (s: UserStrategy) => {
    const parsed = parseBoard(s.strategy_json);
    if (!parsed) {
      toast.error("That strat could not be read. It may have been saved by an older board.");
      return;
    }
    const known = MAPS.find((m) => m.id === s.map_name || m.id === parsed.map);
    setMap(known?.id ?? MAPS[0].id);
    setBoard(parsed.board);
    setTitle(s.title);
    setLoadedId(s.id);
    critique.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Stratbook"
        title="Stratbook"
        description="Sketch a setup and get it critiqued against pro playbooks."
        actions={
          <>
            <Input
              aria-label="Strat title"
              placeholder="Name this setup"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full sm:w-56"
            />
            <Button variant="secondary" onClick={saveStrat} loading={save.isPending} disabled={!canRequest}>
              <Save size={14} aria-hidden="true" /> Save
            </Button>
            <Button onClick={requestCritique} loading={critique.isPending} disabled={!canRequest}>
              <Sparkles size={14} aria-hidden="true" /> Get critique
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <PlanningBoard map={map} onMapChange={changeMap} value={board} onChange={onBoardChange} />
        </Card>
        <CritiquePanel
          text={critique.data?.critique ?? null}
          isPending={critique.isPending}
          error={critique.isError ? (critique.error as Error).message : null}
          canRequest={canRequest}
          onRequest={requestCritique}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Saved strats" description="Open one to load it onto the board." />
        {strategies.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (strategies.data?.strategies.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            description="Sketch a setup, give it a name and press Save. It lands here."
          />
        ) : (
          <ul className="space-y-2">
            {strategies.data!.strategies.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => loadStrat(s)}
                  aria-current={loadedId === s.id ? "true" : undefined}
                  className="surface-2 flex w-full items-center gap-3 px-3 py-2 text-left transition-[border-color] duration-[var(--dur-fast)] hover:border-(--color-focus)"
                  style={{ borderColor: loadedId === s.id ? "var(--color-accent)" : undefined }}
                >
                  <Badge tone="neutral" className="shrink-0">
                    {mapLabel(s.map_name)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.title || "Untitled"}</span>
                  <span className="num shrink-0 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                    {relativeTime(s.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
