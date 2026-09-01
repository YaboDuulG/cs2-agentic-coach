"use client";

import { useEffect, useRef, useState } from "react";
import CS2PlanningBoard, { CS2PlanningBoardRef } from "../CS2PlanningBoard";
import { CanvasStep, CanvasUtility, StratCanvasJson } from "@/lib/api/client";
import { Card } from "@/components/ui";
import { PhaseTimeline } from "./PhaseTimeline";

export interface StratCanvasProps {
  canvas: StratCanvasJson;
  mapName: string;
  /** "T" | "CT" — colors the player pins projected onto the board. */
  side?: string;
}

const UTILITY_MARKER: Record<string, "Smoke" | "Flash" | "HE" | "Molotov"> = {
  smoke: "Smoke",
  flash: "Flash",
  he: "HE",
  molotov: "Molotov",
};

const UTILITY_DOT: Record<string, string> = {
  smoke: "bg-slate-500",
  flash: "bg-yellow-400",
  he: "bg-orange-500",
  molotov: "bg-red-600",
};

// The board's internal canvas is 800x800. Canvas-json coordinates are stored
// normalized (0..1); anything already in pixel space is passed through.
function toBoard(v: number): number {
  return v <= 1 ? v * 800 : v;
}

function markersForStep(step: CanvasStep, side?: string) {
  const playerType = (side ?? "T").toUpperCase() === "CT" ? ("CT" as const) : ("T" as const);
  const players = Object.values(step.positions ?? {}).map((pos) => ({
    x: toBoard(pos.x),
    y: toBoard(pos.y),
    type: playerType,
  }));
  const utility = (step.utility ?? [])
    .filter((u) => UTILITY_MARKER[u.type])
    .map((u) => ({ x: toBoard(u.to.x), y: toBoard(u.to.y), type: UTILITY_MARKER[u.type] }));
  return [...players, ...utility];
}

function coord(p: { x: number; y: number }): string {
  return `(${Math.round(p.x * 100) / 100}, ${Math.round(p.y * 100) / 100})`;
}

function UtilityRow({ util }: { util: CanvasUtility }) {
  return (
    <li
      className="rounded-md border px-3 py-2"
      style={{
        background: "var(--color-bg-secondary)",
        borderColor: "var(--color-border-primary)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${UTILITY_DOT[util.type] ?? "bg-slate-500"}`}
          aria-hidden="true"
        />
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "var(--color-text-primary)" }}
        >
          {util.type}
        </span>
        {util.callout && (
          <span className="truncate text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {util.callout}
          </span>
        )}
      </div>
      <p
        className="mt-1 text-[10px]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}
      >
        {coord(util.from)} → {coord(util.to)}
      </p>
    </li>
  );
}

/**
 * Read-only view of a strat revision: PhaseTimeline above the existing
 * CS2PlanningBoard (reused as-is — no canvas drawing is re-implemented here;
 * the selected step is projected onto it as pins via loadStrategy), with the
 * step's utility list beside it.
 */
export function StratCanvas({ canvas, mapName, side }: StratCanvasProps) {
  const boardRef = useRef<CS2PlanningBoardRef>(null);
  const [selectedStep, setSelectedStep] = useState(0);
  const steps = canvas.steps ?? [];
  const step = steps[Math.min(selectedStep, Math.max(0, steps.length - 1))];

  useEffect(() => {
    if (!boardRef.current || !step) return;
    boardRef.current.loadStrategy({
      map: mapName,
      lines: [],
      markers: markersForStep(step, side),
    });
  }, [step, mapName, side]);

  return (
    <div className="space-y-3">
      <PhaseTimeline steps={steps} selectedStep={selectedStep} onSelect={setSelectedStep} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CS2PlanningBoard ref={boardRef} selectedMap={mapName} />
        </div>
        <Card className="p-4">
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Utility — {step ? step.label : "no step selected"}
          </p>
          {step && step.utility && step.utility.length > 0 ? (
            <ul className="space-y-2">
              {step.utility.map((util, i) => (
                <UtilityRow key={i} util={util} />
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No utility in this step.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
