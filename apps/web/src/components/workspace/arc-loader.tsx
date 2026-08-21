"use client";

import { ARC_PATHS } from "./arche-isologo";

/**
 * Brand loader — the Arche isologo (three stacked arcs) with a top-to-bottom
 * opacity wave that reads as a propagating signal. Shown during the initial
 * "Connecting" state. The wave is driven by the `.arc-wave` rule in
 * globals.css, which holds the logo static when the user prefers reduced motion.
 */
export function ArcLoader({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg
        viewBox="0 0 152 150"
        role="img"
        aria-label="Connecting"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="arc-wave h-[84px] w-[84px] text-primary"
        style={{ filter: "drop-shadow(0 0 12px hsl(var(--primary) / 0.35))" }}
      >
        {ARC_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    </div>
  );
}
