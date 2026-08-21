"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ensureInstanceRunningAction } from "@/actions/spawner";

const INSTANCE_START_POLL_INTERVAL_MS = 2_000;
const INSTANCE_START_TIMEOUT_MS = 120_000;

function formatInstanceStartupError(error: string): string {
  if (error === "start_timeout") {
    return "Workspace startup timed out. Try restarting again.";
  }
  if (error === "status_check_failed") {
    return "Unable to verify workspace startup status.";
  }
  return error;
}

export type InstanceStartupStatus = "starting" | "running" | "error" | null;

export type UseInstanceStartupReturn = {
  instanceStatus: InstanceStartupStatus;
  instanceError: string | null;
};

export function useInstanceStartup(slug: string): UseInstanceStartupReturn {
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [instanceStatus, setInstanceStatus] = useState<InstanceStartupStatus>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;

    const clearTimers = () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const failStartup = (error: string) => {
      clearTimers();
      setInstanceStatus("error");
      setInstanceError(formatInstanceStartupError(error));
    };

    const checkInstanceStatus = async () => {
      if (checking) return;
      checking = true;

      try {
        const result = await ensureInstanceRunningAction(slug);
        if (cancelled) return;

        if (result.status === "error") {
          clearTimers();
          if (result.error === "setup_required") {
            routerRef.current.replace(`/u/${slug}?setup=required`);
            return;
          }
          failStartup(result.error ?? "Unknown error");
          return;
        }

        if (result.status === "running") {
          clearTimers();
          setInstanceStatus("running");
          setInstanceError(null);
          return;
        }

        setInstanceStatus("starting");

        if (!pollingTimer) {
          timeoutTimer = setTimeout(() => {
            if (cancelled) return;
            failStartup("start_timeout");
          }, INSTANCE_START_TIMEOUT_MS);

          pollingTimer = setInterval(() => {
            void checkInstanceStatus();
          }, INSTANCE_START_POLL_INTERVAL_MS);
        }
      } catch {
        if (cancelled) return;
        failStartup("status_check_failed");
      } finally {
        checking = false;
      }
    };

    void checkInstanceStatus();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [slug]);

  return { instanceStatus, instanceError };
}
