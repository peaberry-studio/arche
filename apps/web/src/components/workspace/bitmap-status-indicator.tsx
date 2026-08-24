"use client";

import {
  BITMAP_GRID_COLS,
  BITMAP_GRID_ROWS,
  BitmapGlyph,
  createFrame,
  type BitmapAnimationConfig,
} from "@/components/workspace/bitmap-glyph";
import type { MessageStatusInfo } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import { getWorkspaceToolDisplay } from "@/lib/workspace-tool-display";

type BitmapPattern = "orbit" | "scan" | "columns" | "wave-rows" | "diagonal-swipe";

// Details set by the client while it reattaches to an interrupted stream.
const STREAM_RECOVERY_DETAILS = new Set([
  "stream_interrupted",
  "stream_status_unavailable",
  "upstream_eof",
  "upstream_stream_error",
]);

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
  const isTaskDelegation = toolName === "task";
  const isWaitingForApproval = detail === "permission_required";
  const toolStatusLabel = isWaitingForApproval
    ? "Waiting for approval"
    : isTaskDelegation
      ? detail
        ? `Delegating ${detail}...`
        : "Delegating task..."
      : toolDisplay?.isConnectorTool
        ? toolDisplay.commandLabel
          ? `${toolDisplay.groupLabel} -> ${toolDisplay.commandLabel}...`
          : `${toolDisplay.groupLabel}...`
        : toolName
          ? `Using ${toolName}...`
          : "Running tool...";

  const statusConfig: Record<string, { pattern: BitmapPattern; label: string; className: string }> = {
    thinking: {
      pattern: "orbit",
      label: detail && STREAM_RECOVERY_DETAILS.has(detail) ? "Reconnecting..." : "Thinking...",
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
      <BitmapGlyph
        frames={BITMAP_ANIMATIONS[config.pattern].frames}
        intervalMs={BITMAP_ANIMATIONS[config.pattern].intervalMs}
      />
      <span>{config.label}</span>
    </div>
  );
}
