"use client";

import { useEffect, useState } from "react";

import type { MessageStatusInfo } from "@/lib/opencode/types";
import { getWorkspaceToolDisplay } from "@/lib/workspace-tool-display";
import { cn } from "@/lib/utils";

type BitmapPattern = "orbit" | "scan" | "columns" | "wave-rows" | "diagonal-swipe";

type BitmapAnimationConfig = {
  intervalMs: number;
  frames: boolean[][];
};

const BITMAP_GRID_COLS = 6;
const BITMAP_GRID_ROWS = 6;

function createFrame(cols: number, rows: number, activeDots: Array<[number, number]>): boolean[] {
  const frame = Array.from({ length: cols * rows }, () => false);
  for (const [x, y] of activeDots) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    frame[y * cols + x] = true;
  }
  return frame;
}

function createOrbitFrames(): boolean[][] {
  const ring: Array<[number, number]> = [
    [2, 0], [3, 0], [4, 1], [5, 2],
    [5, 3], [4, 4], [3, 5], [2, 5],
    [1, 4], [0, 3], [0, 2], [1, 1],
  ];

  return ring.map((_, index) =>
    createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, [
      ring[index],
      ring[(index - 1 + ring.length) % ring.length],
      ring[(index - 2 + ring.length) % ring.length],
      [2, 2],
      [3, 3],
    ])
  );
}

function createScanFrames(): boolean[][] {
  const frames: boolean[][] = [];
  const sequence = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];

  for (const row of sequence) {
    const activeDots: Array<[number, number]> = [];
    for (let col = 0; col < BITMAP_GRID_COLS; col += 1) {
      activeDots.push([col, row]);
    }
    activeDots.push([0, Math.max(0, row - 1)]);
    activeDots.push([BITMAP_GRID_COLS - 1, Math.min(BITMAP_GRID_ROWS - 1, row + 1)]);
    frames.push(createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, activeDots));
  }

  return frames;
}

function createColumnsFrames(): boolean[][] {
  const heightsSequence = [
    [1, 3, 5, 2, 4, 1],
    [2, 5, 3, 4, 1, 3],
    [4, 2, 1, 6, 3, 5],
    [3, 4, 6, 1, 5, 2],
    [5, 1, 4, 3, 2, 6],
  ];

  return heightsSequence.map((heights) => {
    const activeDots: Array<[number, number]> = [];

    heights.forEach((height, col) => {
      for (let row = BITMAP_GRID_ROWS - 1; row >= BITMAP_GRID_ROWS - height; row -= 1) {
        activeDots.push([col, row]);
      }
    });

    return createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, activeDots);
  });
}

function createWaveRowsFrames(): boolean[][] {
  const period = BITMAP_GRID_ROWS * 2 - 2;
  const offsets = Array.from({ length: period }, (_, i) => i);

  return offsets.map((offset) => {
    const activeDots: Array<[number, number]> = [];

    for (let col = 0; col < BITMAP_GRID_COLS; col += 1) {
      const phase = (col + offset) % period;
      const row = phase < BITMAP_GRID_ROWS ? phase : period - phase;
      activeDots.push([col, row]);
    }

    return createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, activeDots);
  });
}

function createDiagonalSwipeFrames(): boolean[][] {
  const sweeps = [-10, -7, -4, -1, 2, 5];

  const frames: boolean[][] = sweeps.map((offset) => {
    const activeDots: Array<[number, number]> = [];
    for (let y = 0; y < BITMAP_GRID_ROWS; y += 1) {
      for (let x = 0; x < BITMAP_GRID_COLS; x += 1) {
        const diagonal = x - y * 2;
        if (diagonal === offset || diagonal === offset + 1) {
          activeDots.push([x, y]);
        }
      }
    }
    return createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, activeDots);
  });

  const xShape: Array<[number, number]> = [];
  for (let i = 0; i < BITMAP_GRID_ROWS; i += 1) {
    xShape.push([i, i]);
    xShape.push([BITMAP_GRID_COLS - 1 - i, i]);
  }
  frames.push(createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, xShape));
  frames.push(createFrame(BITMAP_GRID_COLS, BITMAP_GRID_ROWS, [[2, 2], [3, 3]]));

  return frames;
}

const BITMAP_ANIMATIONS: Record<BitmapPattern, BitmapAnimationConfig> = {
  orbit: {
    intervalMs: 190,
    frames: createOrbitFrames(),
  },
  scan: {
    intervalMs: 130,
    frames: createScanFrames(),
  },
  columns: {
    intervalMs: 180,
    frames: createColumnsFrames(),
  },
  "wave-rows": {
    intervalMs: 120,
    frames: createWaveRowsFrames(),
  },
  "diagonal-swipe": {
    intervalMs: 140,
    frames: createDiagonalSwipeFrames(),
  },
};

function BitmapGlyph({ pattern }: { pattern: BitmapPattern }) {
  const animation = BITMAP_ANIMATIONS[pattern];
  const [frameIndex, setFrameIndex] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const dotSizePx = 2;
  const dotGapPx = 1;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setPrefersReducedMotion(mediaQuery.matches);
    onChange();

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % animation.frames.length);
    }, animation.intervalMs);

    return () => window.clearInterval(timer);
  }, [animation.frames.length, animation.intervalMs, prefersReducedMotion]);

  const frame = prefersReducedMotion
    ? animation.frames[0]
    : animation.frames[frameIndex % animation.frames.length];

  return (
    <span
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${BITMAP_GRID_COLS}, ${dotSizePx}px)`,
        gridTemplateRows: `repeat(${BITMAP_GRID_ROWS}, ${dotSizePx}px)`,
        gap: `${dotGapPx}px`,
      }}
      aria-hidden="true"
    >
      {frame.map((isActive, index) => (
        <span
          key={index}
          style={{ width: `${dotSizePx}px`, height: `${dotSizePx}px` }}
          className={cn(
            "rounded-[0.5px] bg-current transition-opacity duration-100",
            isActive ? "opacity-80" : "opacity-[0.08]"
          )}
        />
      ))}
    </span>
  );
}

export function StatusIndicator({
  currentStatus,
  connectorNamesById,
}: {
  currentStatus: MessageStatusInfo | null;
  connectorNamesById?: Record<string, string>;
}) {
  if (!currentStatus) return null;

  const { status, toolName, detail } = currentStatus;
  const toolDisplay = toolName ? getWorkspaceToolDisplay(toolName, connectorNamesById) : null;
  const toolStatusLabel = toolDisplay?.isConnectorTool
    ? toolDisplay.commandLabel
      ? `${toolDisplay.groupLabel} -> ${toolDisplay.commandLabel}...`
      : `${toolDisplay.groupLabel}...`
    : toolName
      ? `Using ${toolName}...`
      : "Running tool...";

  const statusConfig: Record<string, { pattern: BitmapPattern; label: string; className: string }> = {
    thinking: {
      pattern: "orbit",
      label: "Thinking...",
      className: "text-primary",
    },
    reasoning: {
      pattern: "scan",
      label: "Reasoning...",
      className: "text-primary",
    },
    "tool-calling": {
      pattern: "columns",
      label: toolStatusLabel,
      className: "text-primary",
    },
    writing: {
      pattern: "wave-rows",
      label: detail ? `Writing ${detail}...` : "Writing...",
      className: "text-primary",
    },
    error: {
      pattern: "diagonal-swipe",
      label: detail || "Failed to process",
      className: "text-destructive",
    },
  };

  const config = statusConfig[status];
  if (!config) return null;

  return (
    <div
      className={cn(
        "flex w-fit items-center gap-2 rounded-md bg-muted/20 py-1 pl-1.5 pr-2.5 text-[11px] leading-none",
        config.className
      )}
    >
      <BitmapGlyph pattern={config.pattern} />
      <span>{config.label}</span>
    </div>
  );
}
