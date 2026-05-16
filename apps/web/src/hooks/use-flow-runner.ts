"use client";

import { useCallback, useState } from "react";

import { fetchFlowList, runFlowRequest } from "@/lib/flows/client";
import type { FlowListItem } from "@/lib/flows/types";

type UseFlowRunnerOptions = {
  slug: string;
  onRunFlowComplete?: () => Promise<void> | void;
};

export function useFlowRunner({ slug, onRunFlowComplete }: UseFlowRunnerOptions) {
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [isLoadingFlows, setIsLoadingFlows] = useState(false);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadFlows = useCallback(async () => {
    setIsLoadingFlows(true);
    setRunError(null);

    try {
      const result = await fetchFlowList(slug);
      if (!result.ok) {
        setRunError(result.error);
        return;
      }

      setFlows(result.data.flows);
    } catch {
      setRunError("network_error");
    } finally {
      setIsLoadingFlows(false);
    }
  }, [slug]);

  const runFlow = useCallback(
    async (flowId: string) => {
      setRunningFlowId(flowId);
      setRunError(null);

      try {
        const result = await runFlowRequest(slug, flowId);
        if (!result.ok) {
          setRunError(result.error);
          return;
        }

        await onRunFlowComplete?.();
        await loadFlows();
      } catch {
        setRunError("network_error");
      } finally {
        setRunningFlowId(null);
      }
    },
    [loadFlows, onRunFlowComplete, slug]
  );

  return {
    flows,
    isLoadingFlows,
    loadFlows,
    runError,
    runFlow,
    runningFlowId,
  };
}
