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

export type InstanceStartupStatus = "starting" | "migrating_history" | "running" | "error" | null;

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
    let finished = false;
    let migratingHistory = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let migrationPollingTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;
    let checkingMigration = false;
    const migrationController = new AbortController();

    const clearTimers = () => {
      migrationController.abort();
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
      if (migrationPollingTimer) {
        clearInterval(migrationPollingTimer);
        migrationPollingTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const failStartup = (error: string) => {
      finished = true;
      clearTimers();
      setInstanceStatus("error");
      setInstanceError(formatInstanceStartupError(error));
    };

    const checkMigrationStatus = async () => {
      if (checkingMigration || finished || cancelled) return;
      checkingMigration = true;

      try {
        const response = await fetch(`/api/instances/${encodeURIComponent(slug)}/migration-status`, {
          cache: "no-store",
          signal: migrationController.signal,
        });
        if (!response.ok) return;
        const progress: unknown = await response.json();
        if (cancelled || finished || !progress || typeof progress !== "object" ||
          !("migratingHistory" in progress) || typeof progress.migratingHistory !== "boolean") return;
        migratingHistory = progress.migratingHistory;
        setInstanceStatus(migratingHistory ? "migrating_history" : "starting");
      } catch (error) {
        if (!cancelled && !finished) {
          console.error("[startup] Failed to check history migration status", { slug, error });
        }
      } finally {
        checkingMigration = false;
      }
    };

    const checkInstanceStatus = async () => {
      if (checking || finished || cancelled) return;
      checking = true;

      try {
        const result = await ensureInstanceRunningAction(slug);
        if (cancelled || finished) return;

        if (result.status === "error") {
          if (result.error === "setup_required") {
            finished = true;
            clearTimers();
            routerRef.current.replace(`/u/${slug}?setup=required`);
            return;
          }
          failStartup(result.error ?? "Unknown error");
          return;
        }

        if (result.status === "running") {
          finished = true;
          clearTimers();
          setInstanceStatus("running");
          setInstanceError(null);
          return;
        }

        setInstanceStatus(migratingHistory ? "migrating_history" : "starting");

        if (!pollingTimer) {
          pollingTimer = setInterval(() => {
            void checkInstanceStatus();
          }, INSTANCE_START_POLL_INTERVAL_MS);
        }
      } catch {
        if (cancelled || finished) return;
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

    queueMicrotask(() => {
      if (cancelled || finished) return;
      setInstanceStatus("starting");
      setInstanceError(null);
    });
    migrationPollingTimer = setInterval(() => {
      void checkMigrationStatus();
    }, INSTANCE_START_POLL_INTERVAL_MS);
    void checkMigrationStatus();
    void checkInstanceStatus();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [slug]);

  return { instanceStatus, instanceError };
}
