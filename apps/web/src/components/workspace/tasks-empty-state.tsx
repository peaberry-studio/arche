"use client";

import { Lightning } from "@phosphor-icons/react";

export function TasksEmptyState() {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center px-6 text-center text-card-foreground">
      <div className="flex flex-col items-center gap-3">
        <Lightning size={32} className="text-muted-foreground/30" />
        <p className="max-w-[260px] text-sm text-muted-foreground">
          Pick a task from the sidebar to launch a new run, or open a previous run to continue.
        </p>
      </div>
    </div>
  );
}
