"use client";

import { useEffect, useRef } from "react";

import type { WorkspaceSession } from "@/lib/opencode/types";

export function useWorkspaceAutopilotSeenEffect({
  activeSession,
  markAutopilotRunSeen,
}: {
  activeSession: WorkspaceSession | null;
  markAutopilotRunSeen: (runId: string) => Promise<void>;
}) {
  const autoMarkedAutopilotRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const runId = activeSession?.autopilot?.hasUnseenResult
      ? activeSession.autopilot.runId
      : null;
    if (!runId) {
      return;
    }
    if (autoMarkedAutopilotRunIdRef.current === runId) {
      return;
    }

    autoMarkedAutopilotRunIdRef.current = runId;
    void markAutopilotRunSeen(runId);
  }, [activeSession, markAutopilotRunSeen]);
}
