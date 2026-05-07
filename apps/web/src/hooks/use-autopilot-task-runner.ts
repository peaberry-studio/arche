"use client";

import { useCallback, useState } from "react";

import type { AutopilotTaskListItem } from "@/lib/autopilot/types";

type UseAutopilotTaskRunnerOptions = {
  slug: string;
  onRunTaskComplete?: () => Promise<void> | void;
};

export function useAutopilotTaskRunner({
  slug,
  onRunTaskComplete,
}: UseAutopilotTaskRunnerOptions) {
  const [tasks, setTasks] = useState<AutopilotTaskListItem[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoadingTasks(true);
    setRunError(null);

    try {
      const response = await fetch(`/api/u/${slug}/autopilot`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { tasks?: AutopilotTaskListItem[]; error?: string } | null;
      if (!response.ok || !data?.tasks) {
        setRunError(data?.error ?? "load_failed");
        return;
      }

      setTasks(data.tasks);
    } catch {
      setRunError("network_error");
    } finally {
      setIsLoadingTasks(false);
    }
  }, [slug]);

  const runTask = useCallback(
    async (taskId: string) => {
      setRunningTaskId(taskId);
      setRunError(null);

      try {
        const response = await fetch(`/api/u/${slug}/autopilot/${taskId}/run`, {
          method: "POST",
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setRunError(data?.error ?? "run_failed");
          return;
        }

        await onRunTaskComplete?.();
        await loadTasks();
      } catch {
        setRunError("network_error");
      } finally {
        setRunningTaskId(null);
      }
    },
    [loadTasks, onRunTaskComplete, slug]
  );

  return {
    tasks,
    isLoadingTasks,
    runningTaskId,
    runError,
    loadTasks,
    runTask,
  };
}
