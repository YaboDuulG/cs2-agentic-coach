"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { BoardToolbar, type Tool } from "./BoardToolbar";
import { radarImageUrl } from "@/lib/maps";
import { type BoardJson, type BoardPoint, MAPS, MARKER_LABEL, MARKER_TOKEN, PEN_TOKENS, emptyBoard, isBoardEmpty } from "./boardJson";

// Same radar source the analysis page and Viewer3D use.
const HISTORY_MAX = 20;
/** Pen widths are stored relative to a board this many CSS px wide. */
const REF_SIDE = 480;
const PEN_WIDTH = 3;
const MARKER_RADIUS = 13;

export interface PlanningBoardProps {
  map: string;
  onMapChange?: (map: string) => void;
  value?: BoardJson;
  onChange: (json: BoardJson) => void;
  readOnly?: boolean;
  /** Caps the board's side; it otherwise fills the container width. */
  height?: number;
}

interface Radar {
  map: string;
  img: HTMLImageElement | null;
  failed: boolean;
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Line colours are token names; anything else (a legacy hex) is used as-is. */
function resolveColor(el: Element, color: string): string {
  return color.startsWith("--") ? cssVar(el, color) || "currentColor" : color;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function PlanningBoard({ map, onMapChange, value, onChange, readOnly = false, height }: PlanningBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<BoardJson>(() => value ?? emptyBoard());
  const boardRef = useRef(board);
  const emittedRef = useRef<BoardJson | undefined>(value);
  const [history, setHistory] = useState<BoardJson[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [pen, setPen] = useState(PEN_TOKENS[0].token);
  const [side, setSide] = useState(0);
  const [radar, setRadar] = useState<Radar | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const drawing = useRef(false);

  // A new `value` from the parent (a loaded strat, a cleared board) replaces
  // the sketch; our own emits come back as the same object and are ignored.
  useEffect(() => {
    if (value === undefined || value === emittedRef.current) return;
    emittedRef.current = value;
    boardRef.current = value;
    setBoard(value);
    setHistory([]);
  }, [value]);

  const update = useCallback((next: BoardJson) => {
    boardRef.current = next;
    setBoard(next);
  }, []);

  const emit = useCallback(
    (next: BoardJson) => {
      emittedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const snapshot = useCallback(() => {
    const current = boardRef.current;
    setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), current]);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    update(prev);
    emit(prev);
  }, [history, update, emit]);

  const clear = useCallback(() => {
    snapshot();
    const next = emptyBoard();
    update(next);
    emit(next);
    setConfirmClear(false);
  }, [snapshot, update, emit]);

  // Ctrl+Z anywhere on the page, except while typing in a field.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, readOnly]);

  // Fit the container width, 1:1.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setSide(Math.floor(height ? Math.min(w, height) : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // The radar is keyed by map, so a stale image never paints under a new map.
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => alive && setRadar({ map, img, failed: false });
    img.onerror = () => alive && setRadar({ map, img: null, failed: true });
    img.src = radarImageUrl(map);
    return () => {
      alive = false;
    };
  }, [map]);

  // Colours are read from the theme at draw time; repaint when it switches.
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => mo.disconnect();
  }, []);

  const bg = radar?.map === map ? radar.img : null;
  const bgFailed = radar?.map === map ? radar.failed : false;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || side === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mono = cssVar(canvas, "--font-mono") || "ui-monospace, monospace";

    ctx.fillStyle = cssVar(canvas, "--color-surface-2");
    ctx.fillRect(0, 0, side, side);
    if (bg) {
      ctx.drawImage(bg, 0, 0, side, side);
    } else if (bgFailed) {
      ctx.fillStyle = cssVar(canvas, "--color-text-3");
      ctx.font = `13px ${mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Map radar unavailable", side / 2, side / 2);
    }

    const scale = side / REF_SIDE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const line of board.lines) {
      if (line.points.length === 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = resolveColor(canvas, line.color);
      ctx.lineWidth = Math.max(1.5, line.width * scale);
      const [first, ...rest] = line.points;
      ctx.moveTo(first.x * side, first.y * side);
      if (rest.length === 0) ctx.lineTo(first.x * side + 0.01, first.y * side);
      for (const p of rest) ctx.lineTo(p.x * side, p.y * side);
      ctx.stroke();
    }

    ctx.font = `600 11px ${mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ring = cssVar(canvas, "--color-bg");
    for (const m of board.markers) {
      const x = m.x * side;
      const y = m.y * side;
      ctx.beginPath();
      ctx.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = cssVar(canvas, MARKER_TOKEN[m.type]);
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = m.type === "smoke" ? cssVar(canvas, "--color-text") : ring;
      ctx.fillText(m.label ?? MARKER_LABEL[m.type], x, y + 0.5);
    }
  }, [bg, bgFailed, board, side, themeTick]);

  const toPoint = (e: ReactPointerEvent<HTMLCanvasElement>): BoardPoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (readOnly || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPoint(e);
    snapshot();
    const current = boardRef.current;
    if (tool === "pen") {
      drawing.current = true;
      update({ ...current, lines: [...current.lines, { points: [p], color: pen, width: PEN_WIDTH }] });
    } else {
      const next = { ...current, markers: [...current.markers, { type: tool, x: p.x, y: p.y }] };
      update(next);
      emit(next);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const current = boardRef.current;
    const last = current.lines[current.lines.length - 1];
    if (!last) return;
    update({ ...current, lines: [...current.lines.slice(0, -1), { ...last, points: [...last.points, toPoint(e)] }] });
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emit(boardRef.current);
  };

  const empty = isBoardEmpty(board);

  return (
    <div className="flex flex-col gap-3">
      {!readOnly ? (
        <BoardToolbar
          map={map}
          onMapChange={onMapChange}
          tool={tool}
          onToolChange={setTool}
          pen={pen}
          onPenChange={setPen}
          canUndo={history.length > 0}
          onUndo={undo}
          canClear={!empty}
          onClear={() => setConfirmClear(true)}
        />
      ) : null}

      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${MAPS.find((m) => m.id === map)?.name ?? map} planning board`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn("hairline mx-auto block rounded-(--radius-md) border", !readOnly && "cursor-crosshair")}
          style={{ width: side, height: side, touchAction: "none" }}
        />
      </div>

      {!readOnly && empty ? (
        <p className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
          Draw paths with the pen and drop pins for players and utility. Switching maps starts a new sketch.
        </p>
      ) : null}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear the board?"
        description="Every line and pin goes. Undo brings them back."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmClear(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={clear}>
            Clear
          </Button>
        </div>
      </Modal>
    </div>
  );
}
