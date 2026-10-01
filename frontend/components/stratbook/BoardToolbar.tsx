"use client";

import { Eraser, Pencil, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Select } from "@/components/ui";
import { type MarkerType, MAPS, MARKER_NAME, MARKER_TOKEN, MARKER_TYPES, PEN_TOKENS } from "./boardJson";

export type Tool = "pen" | MarkerType;

export interface BoardToolbarProps {
  map: string;
  onMapChange?: (map: string) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  pen: string;
  onPenChange: (token: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  canClear: boolean;
  onClear: () => void;
}

/** Map select, pen + colours, the six CS markers, undo and clear. */
export function BoardToolbar({ map, onMapChange, tool, onToolChange, pen, onPenChange, canUndo, onUndo, canClear, onClear }: BoardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Board tools">
      <Select aria-label="Map" className="w-auto" value={map} onChange={(e) => onMapChange?.(e.target.value)}>
        {MAPS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <Divider />
      <ToolButton pressed={tool === "pen"} onClick={() => onToolChange("pen")} title="Draw">
        <Pencil size={14} aria-hidden="true" /> Draw
      </ToolButton>
      <div className="flex items-center gap-1.5" role="group" aria-label="Pen colour">
        {PEN_TOKENS.map((c) => (
          <button
            key={c.token}
            type="button"
            aria-label={c.name}
            aria-pressed={pen === c.token}
            onClick={() => {
              onPenChange(c.token);
              onToolChange("pen");
            }}
            className="h-5 w-5 rounded-full border-2 transition-[transform,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:scale-110"
            style={{
              background: `var(${c.token})`,
              borderColor: pen === c.token && tool === "pen" ? "var(--color-text)" : "var(--color-line-strong)",
            }}
          />
        ))}
      </div>
      <Divider />
      {MARKER_TYPES.map((t) => (
        <ToolButton key={t} pressed={tool === t} onClick={() => onToolChange(t)} title={`Place ${MARKER_NAME[t]}`}>
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${MARKER_TOKEN[t]})` }} aria-hidden="true" />
          {MARKER_NAME[t]}
        </ToolButton>
      ))}
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={14} aria-hidden="true" /> Undo
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={!canClear} title="Clear the board">
          <Eraser size={14} aria-hidden="true" /> Clear
        </Button>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="hidden h-6 w-px sm:block" style={{ background: "var(--color-line)" }} aria-hidden="true" />;
}

function ToolButton({ pressed, onClick, title, children }: { pressed: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-(--radius-sm) border px-2.5 text-[12px] font-semibold transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
      style={{
        background: pressed ? "var(--color-accent-soft)" : "var(--color-surface-2)",
        color: pressed ? "var(--color-accent)" : "var(--color-text-2)",
        borderColor: pressed ? "var(--color-accent)" : "var(--color-line)",
      }}
    >
      {children}
    </button>
  );
}
