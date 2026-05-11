"use client";

import { useCallback, useState } from "react";

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
      const response = await fetch(`/api/u/${slug}/flows`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { flows?: FlowListItem[]; error?: string } | null;
      if (!response.ok || !data?.flows) {
        setRunError(data?.error ?? "load_failed");
        return;
      }

      setFlows(data.flows);
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
        const response = await fetch(`/api/u/${slug}/flows/${flowId}/run`, { method: "POST" });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setRunError(data?.error ?? "run_failed");
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
