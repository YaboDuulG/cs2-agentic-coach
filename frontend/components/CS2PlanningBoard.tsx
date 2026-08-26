import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Trash2, Undo, Map } from "lucide-react";

export interface CS2PlanningBoardRef {
  exportStrategy: () => { map: string; lines: Line[]; markers: Marker[] };
  loadStrategy: (state: { map: string; lines: Line[]; markers: Marker[] }) => void;
}

interface CS2PlanningBoardProps {
  selectedMap?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Line {
  points: Point[];
  color: string;
  width: number;
}

interface Marker {
  x: number;
  y: number;
  type: "CT" | "T" | "Smoke" | "Flash" | "HE" | "Molotov";
}

const MAPS = [
  { id: "de_mirage", name: "Mirage" },
  { id: "de_nuke", name: "Nuke" },
  { id: "de_anubis", name: "Anubis" },
  { id: "de_ancient", name: "Ancient" },
  { id: "de_inferno", name: "Inferno" },
  { id: "de_vertigo", name: "Vertigo" },
  { id: "de_dust2", name: "Dust 2" },
];

const MARKER_COLORS: Record<string, string> = {
  CT: "bg-[#2D7DD2] text-white border-white/40",
  T: "bg-[#FF4D6D] text-white border-white/40",
  Smoke: "bg-slate-500 text-white border-slate-300",
  Flash: "bg-yellow-400 text-slate-950 border-yellow-200",
  HE: "bg-orange-500 text-white border-orange-300",
  Molotov: "bg-red-600 text-white border-red-400",
};

const CS2PlanningBoard = forwardRef<CS2PlanningBoardRef, CS2PlanningBoardProps>(
  ({ selectedMap }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    const [map, setMap] = useState<string>("de_mirage");
    const [tool, setTool] = useState<"pen" | "CT" | "T" | "Smoke" | "Flash" | "HE" | "Molotov">("pen");
    const [color, setColor] = useState<string>("#C9A227");
    const [lineWidth, setLineWidth] = useState<number>(3);
    
    const [lines, setLines] = useState<Line[]>([]);
    const [markers, setMarkers] = useState<Marker[]>([]);
    const [history, setHistory] = useState<{ lines: Line[]; markers: Marker[] }[]>([]);
    const [isDrawing, setIsDrawing] = useState<boolean>(false);
    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

    useImperativeHandle(ref, () => ({
      exportStrategy: () => ({ map, lines, markers }),
      loadStrategy: (state) => {
        setMap(state.map);
        setLines(state.lines || []);
        setMarkers(state.markers || []);
        setHistory([]);
      }
    }));

    // Sync with prop from parent strategy list selection
    useEffect(() => {
    if (selectedMap) {
      const normalized = selectedMap.toLowerCase().replace("de_", "");
      const matched = MAPS.find(m => m.id === selectedMap || m.id === `de_${normalized}`);
      if (matched) {
        setMap(matched.id);
      }
    }
  }, [selectedMap]);

  // Load Background Image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/${map}_radar_psd.png`;
    img.onload = () => {
      setBgImage(img);
    };
    img.onerror = () => {
      setBgImage(null);
    };
  }, [map]);

  // Handle Resize & Repaint
  useEffect(() => {
    redraw();
  }, [bgImage, lines, markers]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Map background
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#0a121e";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#4A6A8A";
      ctx.font = "14px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Failed to load map radar", canvas.width / 2, canvas.height / 2);
    }

    // 2. Draw lines
    lines.forEach(line => {
      if (line.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      ctx.stroke();
    });

    // 3. Draw markers
    markers.forEach(m => {
      ctx.beginPath();
      let fillColor = "#555";
      const label = m.type;
      if (m.type === "CT") fillColor = "#2D7DD2";
      else if (m.type === "T") fillColor = "#FF4D6D";
      else if (m.type === "Smoke") fillColor = "#708090";
      else if (m.type === "Flash") fillColor = "#F1C40F";
      else if (m.type === "HE") fillColor = "#E67E22";
      else if (m.type === "Molotov") fillColor = "#E74C3C";

      // Badge circle
      ctx.arc(m.x, m.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF88";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Text label
      ctx.font = "9px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = m.type === "Flash" ? "#111827" : "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label.slice(0, 2), m.x, m.y);
    });
  };

  const saveToHistory = (newLines = lines, newMarkers = markers) => {
    setHistory(prev => [...prev.slice(-19), { lines: newLines, markers: newMarkers }]);
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Scale appropriately based on CSS size vs internal size
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCoordinates(e);
    if (tool === "pen") {
      setIsDrawing(true);
      saveToHistory();
      const newLine: Line = {
        points: [coords],
        color,
        width: lineWidth,
      };
      setLines(prev => [...prev, newLine]);
    } else {
      // Place marker
      saveToHistory();
      const newMarker: Marker = {
        x: coords.x,
        y: coords.y,
        type: tool,
      };
      setMarkers(prev => [...prev, newMarker]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool !== "pen") return;
    const coords = getCoordinates(e);
    setLines(prev => {
      if (prev.length === 0) return prev;
      const lastLine = prev[prev.length - 1];
      const updatedLine = {
        ...lastLine,
        points: [...lastLine.points, coords],
      };
      return [...prev.slice(0, -1), updatedLine];
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setLines(previous.lines);
    setMarkers(previous.markers);
    setHistory(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    saveToHistory();
    setLines([]);
    setMarkers([]);
  };

  return (
    <div ref={containerRef} className="card p-5 flex flex-col gap-4 h-[650px] w-full">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-border-primary)] select-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-secondary-soft)] border border-[var(--color-border-secondary)] flex items-center justify-center text-[var(--color-accent-secondary)]">
            📋
          </div>
          <div>
            <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider font-mono">Tactical Planning Board</h3>
            <p className="text-[9px] text-[var(--color-text-muted)] font-mono mt-0.5">Sketch tactics and place pins</p>
          </div>
        </div>

        {/* Map Select */}
        <div className="flex items-center gap-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded px-2.5 py-1">
          <Map size={11} className="text-[var(--color-text-secondary)]" />
          <select
            value={map}
            onChange={(e) => setMap(e.target.value)}
            className="bg-transparent text-[10px] text-[var(--color-text-secondary)] font-bold uppercase tracking-wider outline-none cursor-pointer"
          >
            {MAPS.map(m => (
              <option key={m.id} value={m.id} className="bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]">{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Board tools */}
      <div className="flex flex-wrap gap-2.5 select-none justify-between bg-[var(--color-bg-secondary)]/40 p-2 rounded-lg border border-[var(--color-border-primary)]">
        <div className="flex flex-wrap gap-2">
          {/* Pen Toggle */}
          <button
            onClick={() => setTool("pen")}
            className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer ${tool === "pen" ? "bg-[var(--color-accent-primary)] text-white" : "bg-[var(--color-bg-secondary)]/60 hover:bg-[var(--color-accent-soft)] text-[var(--color-text-secondary)] border border-[var(--color-border-primary)]"}`}
          >
            ✏️ Drawing
          </button>

          {/* Color Palettes (Pen Mode) */}
          {tool === "pen" && (
            <div className="flex items-center gap-1.5 border-l border-[var(--color-border-primary)] pl-2.5">
              {["#C9A227", "#FF4D6D", "#22D3A0", "#2D7DD2"].map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-4.5 h-4.5 rounded-full border cursor-pointer transition-transform hover:scale-110"
                  style={{ backgroundColor: c, borderColor: color === c ? "var(--color-text-primary)" : "var(--color-border-strong)" }}
                />
              ))}
            </div>
          )}

          {/* Markers */}
          {(["CT", "T", "Smoke", "Flash", "HE", "Molotov"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-2.5 py-1 py-1.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${tool === t ? "bg-[var(--color-bg-elevated)] border-[var(--color-border-strong)] text-[var(--color-text-primary)] shadow-inner" : "bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] border-[var(--color-border-primary)] hover:bg-[var(--color-bg-secondary)]"}`}
            >
              <span className={`inline-block w-2.5 h-2.5 rounded-full mr-1.5 text-[8px] font-bold leading-none align-middle ${t === "CT" ? "bg-[#2D7DD2]" : t === "T" ? "bg-[#FF4D6D]" : t === "Smoke" ? "bg-slate-500" : t === "Flash" ? "bg-yellow-400" : t === "HE" ? "bg-orange-500" : "bg-red-600"}`} />
              {t}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {/* Undo */}
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className={`p-1.5 rounded transition-colors flex items-center gap-1 border ${history.length > 0 ? "bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-primary)] cursor-pointer" : "text-[var(--color-text-muted)] border-[var(--color-border-primary)] cursor-not-allowed"}`}
            title="Undo"
          >
            <Undo size={12} />
          </button>
          {/* Clear */}
          <button
            onClick={handleClear}
            className="p-1.5 bg-[var(--color-bg-primary)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/30 text-[var(--color-text-secondary)] border border-[var(--color-border-primary)] rounded transition-colors cursor-pointer flex items-center gap-1"
            title="Clear all"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Canvas container */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-[var(--color-bg-primary)]/80 rounded-xl border border-[var(--color-border-primary)] p-2 shadow-inner">
        <canvas
          ref={canvasRef}
          width={800}
          height={800}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="w-full max-w-[500px] aspect-square rounded-lg shadow-lg cursor-crosshair"
          style={{ background: "var(--color-bg-secondary)" }}
        />
      </div>
    </div>
  );
});

CS2PlanningBoard.displayName = "CS2PlanningBoard";

export default CS2PlanningBoard;
