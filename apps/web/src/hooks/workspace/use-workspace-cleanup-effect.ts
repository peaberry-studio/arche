"use client";

import { useEffect, type MutableRefObject } from "react";

export function useWorkspaceCleanupEffect({
  abortAllStreams,
  isMountedRef,
  workspaceRefreshTimeoutRef,
}: {
  abortAllStreams: () => void;
  isMountedRef: MutableRefObject<boolean>;
  workspaceRefreshTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (workspaceRefreshTimeoutRef.current) {
        clearTimeout(workspaceRefreshTimeoutRef.current);
        workspaceRefreshTimeoutRef.current = null;
      }
      abortAllStreams();
    };
  }, [abortAllStreams, isMountedRef, workspaceRefreshTimeoutRef]);
}
