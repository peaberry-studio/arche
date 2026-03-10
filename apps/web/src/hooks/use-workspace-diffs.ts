"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspaceDiffsAction } from "@/actions/opencode";

export type WorkspaceDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  diff: string;
  conflicted: boolean;
};

export type UseWorkspaceDiffsReturn = {
  diffs: WorkspaceDiff[];
  isLoadingDiffs: boolean;
  diffsError: string | null;
  refreshDiffs: (options?: { force?: boolean }) => Promise<void>;
  triggerDiffsRefresh: () => void;
};

export function useWorkspaceDiffs(
  slug: string,
  enabled: boolean,
  isConnected: boolean,
): UseWorkspaceDiffsReturn {
  const [diffs, setDiffs] = useState<WorkspaceDiff[]>([]);
  const [isLoadingDiffs, setIsLoadingDiffs] = useState(false);
  const [diffsError, setDiffsError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isLoadingRef = useRef(false);

  const refreshDiffs = useCallback(
    async (options?: { force?: boolean }) => {
      if (!enabled) return;
      if (!options?.force && !isConnected) return;
      if (isLoadingRef.current) return;

      setIsLoadingDiffs(true);
      isLoadingRef.current = true;
      try {
        const result = await getWorkspaceDiffsAction(slug);
        if (result.ok && result.diffs) {
          setDiffs(result.diffs);
          setDiffsError(null);
        } else {
          setDiffsError(result.error ?? "unknown");
        }
      } finally {
        setIsLoadingDiffs(false);
        isLoadingRef.current = false;
      }
    },
    [slug, enabled, isConnected]
  );

  const triggerDiffsRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0 && isConnected) {
      refreshDiffs();
    }
  }, [refreshTrigger, isConnected, refreshDiffs]);

  return {
    diffs,
    isLoadingDiffs,
    diffsError,
    refreshDiffs,
    triggerDiffsRefresh,
  };
}
