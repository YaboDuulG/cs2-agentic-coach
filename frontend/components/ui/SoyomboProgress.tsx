"use client";

// The signature moment (DESIGN_PLAN §3/§8): while the pipeline works, the
// Soyombo mark assembles element by element — flame → sun → moon → bars —
// one element per completed stage, the active element pulsing. This is the
// one screen users stare at, so the delight budget lives here (Emil's
// frequency gate: rare + long attention). Everything is CSS transitions on
// opacity (interruptible, reduced-motion safe by nature — no movement).

export const PIPELINE_STAGES = ["Parse", "Compare", "Analyze", "Report"] as const;

interface SoyomboProgressProps {
  /** 0..4 — completed stages; 4 = done. */
  stage: number;
  size?: number;
  /** Optional status line under the stage labels (e.g. queue position). */
  detail?: string;
}

// Which SVG elements belong to which stage.
const STAGE_OF = {
  flame: 0,
  sun: 1,
  moon: 2,
  bars: 3,
} as const;

export function SoyomboProgress({ stage, size = 140, detail }: SoyomboProgressProps) {
  // Gentle pulse for the ACTIVE element only, via CSS animation class.
  const opacityFor = (element: keyof typeof STAGE_OF) => {
    const s = STAGE_OF[element];
    if (stage > s) return 1; // complete
    if (stage === s) return 0.55; // active — pulsing via class
    return 0.12; // pending
  };
  const classFor = (element: keyof typeof STAGE_OF) =>
    stage === STAGE_OF[element] ? "soyombo-active" : undefined;

  // Announce stage changes to screen readers without motion — purely
  // derived from the prop; aria-live picks up the text change on re-render.
  const announced =
    stage >= PIPELINE_STAGES.length
      ? "Report ready"
      : `${PIPELINE_STAGES[stage]} in progress`;

  const gold = "var(--color-accent-secondary)";

  return (
    <div className="flex flex-col items-center gap-5" role="status" aria-live="polite">
      <svg
        width={size}
        height={size * 1.2}
        viewBox="0 0 100 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g
          className={classFor("flame")}
          style={{ opacity: opacityFor("flame"), transition: "opacity 400ms var(--ease-out)" }}
        >
          <path
            d="M50 5 C46 15, 38 18, 42 28 C44 33, 50 35, 50 35 C50 35, 56 33, 58 28 C62 18, 54 15, 50 5Z"
            fill={gold}
          />
        </g>
        <g
          className={classFor("sun")}
          style={{ opacity: opacityFor("sun"), transition: "opacity 400ms var(--ease-out)" }}
        >
          <circle cx="50" cy="45" r="8" fill={gold} />
          <circle cx="50" cy="45" r="12" fill="none" stroke={gold} strokeWidth="2.5" />
        </g>
        <g
          className={classFor("moon")}
          style={{ opacity: opacityFor("moon"), transition: "opacity 400ms var(--ease-out)" }}
        >
          <path
            d="M35 62 Q50 54 65 62"
            stroke={gold}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        <g
          className={classFor("bars")}
          style={{ opacity: opacityFor("bars"), transition: "opacity 400ms var(--ease-out)" }}
        >
          <rect x="22" y="72" width="56" height="5" rx="2" fill={gold} />
          <rect x="22" y="82" width="56" height="5" rx="2" fill={gold} />
          <rect x="18" y="72" width="4" height="40" rx="2" fill={gold} />
          <rect x="78" y="72" width="4" height="40" rx="2" fill={gold} />
          <rect x="22" y="107" width="56" height="5" rx="2" fill={gold} />
        </g>
      </svg>

      <ol className="flex items-center gap-3 sm:gap-5" aria-hidden="true">
        {PIPELINE_STAGES.map((label, i) => {
          const state = stage > i ? "done" : stage === i ? "active" : "pending";
          return (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    state === "done"
                      ? "var(--color-success)"
                      : state === "active"
                        ? "var(--color-accent-secondary)"
                        : "var(--color-border-primary)",
                  transition: "background-color 300ms ease",
                }}
              />
              <span
                className="text-[11px] font-mono uppercase tracking-widest"
                style={{
                  color:
                    state === "pending"
                      ? "var(--color-text-muted)"
                      : "var(--color-text-primary)",
                  transition: "color 300ms ease",
                }}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      <span className="sr-only">{announced}</span>
      {detail && (
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          {detail}
        </p>
      )}
    </div>
  );
}
