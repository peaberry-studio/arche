"use client";

import { GitBranch } from "@phosphor-icons/react";

export function FlowsEmptyState() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-card-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/50">
        <GitBranch size={22} weight="regular" />
      </div>
      <p className="mt-4 max-w-[280px] text-sm font-medium text-foreground/80">
        Run a flow
      </p>
      <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-muted-foreground">
        Pick a flow from the sidebar to launch a new run, or open a previous run to inspect its steps.
      </p>
    </div>
  );
}
