"use client";

/**
 * Cosmic orbital loader — an asteroid core with orbiting nebulous bodies
 * and a starfield background, used for the initial "Connecting" state.
 */
export function CosmicLoader({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative h-48 w-48">
        {/* Starfield — scattered micro-dots */}
        <Stars />

        {/* Outer orbit ring (warm subtle) */}
        <div className="absolute inset-2 animate-[cosmic-spin_24s_linear_infinite] rounded-full border border-dashed border-orange-400/8" />

        {/* Middle orbit ring */}
        <div className="absolute inset-8 animate-[cosmic-spin_16s_linear_infinite_reverse] rounded-full border border-amber-400/12" />

        {/* Inner orbit ring */}
        <div className="absolute inset-14 animate-[cosmic-spin_10s_linear_infinite] rounded-full border border-dashed border-orange-300/8" />

        {/* Orbiting body 1 — large, slow, outer orbit */}
        <div className="absolute inset-2 animate-[cosmic-spin_8s_linear_infinite]">
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-orange-400/20 blur-md" />
              <div
                className="h-3 w-3 rounded-full bg-orange-400/60 blur-[0.5px]"
                style={{ boxShadow: "0 0 14px 4px rgba(251, 146, 60, 0.3)" }}
              />
            </div>
          </div>
        </div>

        {/* Orbiting body 2 — medium, mid orbit, counter-clockwise */}
        <div className="absolute inset-8 animate-[cosmic-spin_5s_linear_infinite_reverse]">
          <div className="absolute -right-1 top-1/2 -translate-y-1/2">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-amber-500/15 blur-md" />
              <div
                className="h-2 w-2 rounded-full bg-amber-500/50 blur-[0.5px]"
                style={{ boxShadow: "0 0 10px 3px rgba(245, 158, 11, 0.25)" }}
              />
            </div>
          </div>
        </div>

        {/* Orbiting body 3 — small, fast, inner orbit */}
        <div className="absolute inset-14 animate-[cosmic-spin_3s_linear_infinite]">
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2">
            <div className="relative">
              <div className="absolute -inset-0.5 rounded-full bg-orange-300/20 blur-sm" />
              <div
                className="h-1.5 w-1.5 rounded-full bg-orange-300/60 blur-[0.3px]"
                style={{ boxShadow: "0 0 6px 2px rgba(253, 186, 116, 0.3)" }}
              />
            </div>
          </div>
        </div>

        {/* Orbiting body 4 — tiny, outer, offset start */}
        <div
          className="absolute inset-4 animate-[cosmic-spin_12s_linear_infinite]"
          style={{ animationDelay: "-4s" }}
        >
          <div className="absolute -left-0.5 top-1/2 -translate-y-1/2">
            <div className="relative">
              <div className="absolute -inset-0.5 rounded-full bg-amber-300/15 blur-[2px]" />
              <div
                className="h-1 w-1 rounded-full bg-amber-300/40 blur-[1px]"
                style={{ boxShadow: "0 0 4px 1px rgba(252, 211, 77, 0.2)" }}
              />
            </div>
          </div>
        </div>

        {/* Core asteroid — glowing center sphere */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {/* Outer glow */}
            <div className="absolute -inset-4 animate-pulse rounded-full bg-orange-500/[0.08] blur-xl" />
            {/* Mid glow */}
            <div
              className="absolute -inset-2 animate-pulse rounded-full bg-amber-500/10 blur-md"
              style={{ animationDelay: "500ms" }}
            />
            {/* Core surface */}
            <div
              className="relative h-10 w-10 rounded-full bg-gradient-to-br from-orange-900/20 via-amber-800/30 to-orange-950/10"
              style={{
                boxShadow:
                  "inset -3px -3px 8px rgba(0,0,0,0.3), inset 2px 2px 6px rgba(255,255,255,0.05)",
              }}
            >
              {/* Surface detail — crater-like highlight */}
              <div className="absolute left-2 top-1.5 h-2 w-2 rounded-full bg-orange-400/10 blur-[1px]" />
              <div className="absolute bottom-2.5 right-2 h-1 w-1 rounded-full bg-amber-300/5" />
              {/* Subtle surface shine */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-transparent to-white/[0.07]" />
            </div>
          </div>
        </div>

        {/* Comet trail particle — drifts across */}
        <div
          className="absolute inset-0 animate-[cosmic-spin_20s_linear_infinite]"
          style={{ animationDelay: "-7s" }}
        >
          <div className="absolute right-6 top-4">
            <div className="h-0.5 w-4 rotate-45 rounded-full bg-gradient-to-r from-transparent to-orange-400/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Scattered star dots — purely decorative */
function Stars() {
  const stars = [
    { x: 8, y: 12, size: 1, opacity: 0.3, delay: 0, warm: true },
    { x: 85, y: 8, size: 1.5, opacity: 0.2, delay: 1.2, warm: false },
    { x: 92, y: 78, size: 1, opacity: 0.25, delay: 0.5, warm: true },
    { x: 15, y: 85, size: 1.5, opacity: 0.15, delay: 2.1, warm: false },
    { x: 45, y: 5, size: 1, opacity: 0.2, delay: 0.8, warm: true },
    { x: 5, y: 50, size: 1, opacity: 0.15, delay: 1.5, warm: false },
    { x: 95, y: 40, size: 1, opacity: 0.2, delay: 2.5, warm: true },
    { x: 30, y: 92, size: 1, opacity: 0.15, delay: 3.0, warm: false },
    { x: 72, y: 3, size: 1.5, opacity: 0.2, delay: 0.3, warm: true },
    { x: 18, y: 35, size: 1, opacity: 0.1, delay: 1.8, warm: false },
    { x: 78, y: 90, size: 1, opacity: 0.2, delay: 2.8, warm: true },
    { x: 55, y: 95, size: 1, opacity: 0.15, delay: 0.6, warm: false },
  ];

  return (
    <>
      {stars.map((star, i) => (
        <div
          key={i}
          className={`absolute animate-pulse rounded-full ${star.warm ? "bg-orange-200" : "bg-muted-foreground"}`}
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            animationDelay: `${star.delay}s`,
            animationDuration: "3s",
          }}
        />
      ))}
    </>
  );
}
