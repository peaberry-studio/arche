"use client";

import { useEffect } from "react";

const INSTANCE_ACTIVITY_HEARTBEAT_MS = 20_000;

/**
 * Sends periodic PATCH requests to keep the workspace instance alive
 * while this tab is open.
 */
export function useInstanceHeartbeat(slug: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const heartbeat = async () => {
      try {
        await fetch(`/api/instances/${slug}/activity`, {
          method: "PATCH",
          cache: "no-store",
        });
      } catch {
        // best-effort
      }
    };

    void heartbeat();

    const interval = setInterval(() => {
      if (cancelled) return;
      void heartbeat();
    }, INSTANCE_ACTIVITY_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, slug]);
}
