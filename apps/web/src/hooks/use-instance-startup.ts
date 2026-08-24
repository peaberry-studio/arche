"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ensureInstanceRunningAction } from "@/actions/spawner";

const INSTANCE_START_POLL_INTERVAL_MS = 2_000;

// Client-side timeout that must exceed the server's ARCHE_START_TIMEOUT_MS
// (default 120s) by a margin so the UI only surfaces an error when the server
// action genuinely stalls, not while it is about to succeed.
export const INSTANCE_START_TIMEOUT_MS = 150_000;

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

  // Initialized to "starting" so the UI shows the startup state immediately and
  // the timeout below is armed before the first awaited server action. The
  // workspace shell treats null and "starting" identically.
  const [instanceStatus, setInstanceStatus] = useState<InstanceStartupStatus>("starting");
  const [instanceError, setInstanceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
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
      timedOut = true;
      clearTimers();
      setInstanceStatus("error");
      setInstanceError(formatInstanceStartupError(error));
    };

    const checkInstanceStatus = async () => {
      if (checking || timedOut || cancelled) return;
      checking = true;

      try {
        const result = await ensureInstanceRunningAction(slug);
        if (cancelled || timedOut) return;

        if (result.status === "error") {
          if (result.error === "setup_required") {
            clearTimers();
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
          pollingTimer = setInterval(() => {
            void checkInstanceStatus();
          }, INSTANCE_START_POLL_INTERVAL_MS);
        }
      } catch {
        if (cancelled || timedOut) return;
        failStartup("status_check_failed");
      } finally {
        checking = false;
      }
    };

    // Arm an independent timeout BEFORE awaiting the server action, so a
    // blocked action/proxy/network can no longer leave the UI spinning forever.
    // Once the timeout fires, late responses for this attempt are ignored.
    timeoutTimer = setTimeout(() => {
      if (cancelled) return;
      failStartup("start_timeout");
    }, INSTANCE_START_TIMEOUT_MS);

    void checkInstanceStatus();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [slug]);

  return { instanceStatus, instanceError };
}
