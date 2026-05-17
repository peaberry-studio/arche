"use client";

import { useEffect, useRef } from "react";

import type { WorkspaceSession } from "@/lib/opencode/types";

export function useWorkspaceFlowSeenEffect({
  activeSession,
  markFlowRunSeen,
}: {
  activeSession: WorkspaceSession | null;
  markFlowRunSeen: (runId: string) => Promise<void>;
}) {
  const autoMarkedFlowRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const runId = activeSession?.flow?.hasUnseenResult
      ? activeSession.flow.runId
      : null;
    if (!runId) return;
    if (autoMarkedFlowRunIdRef.current === runId) return;

    autoMarkedFlowRunIdRef.current = runId;
    void markFlowRunSeen(runId);
  }, [activeSession, markFlowRunSeen]);
}
