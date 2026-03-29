"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ConfigStatus = {
  /** Whether there are pending config changes that require a restart */
  pending: boolean;
  /** Whether a restart is currently in progress */
  restarting: boolean;
  /** Error from the last restart attempt, if any */
  restartError: string | null;
  /** Trigger a workspace restart */
  restart: () => Promise<void>;
};

const POLL_INTERVAL = 30_000; // 30 seconds

export function useConfigStatus(slug: string, enabled: boolean): ConfigStatus {
  const [pending, setPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${slug}/config-status`);
      if (!res.ok) return;
      const data = (await res.json()) as { pending?: boolean };
      setPending(Boolean(data.pending));
    } catch {
      // silent — polling is best-effort
    }
  }, [slug]);

  useEffect(() => {
    if (!enabled) return;

    // Check shortly after mount, then poll at interval
    const initial = setTimeout(() => void checkStatus(), 0);

    intervalRef.current = setInterval(() => {
      void checkStatus();
    }, POLL_INTERVAL);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkStatus, enabled]);

  const restart = useCallback(async () => {
    setRestarting(true);
    setRestartError(null);

    try {
      const res = await fetch(`/api/instances/${slug}/restart`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRestartError(data.error ?? "restart_failed");
        setRestarting(false);
        return;
      }

      // Restart succeeded — reload the page to reconnect
      window.location.reload();
    } catch {
      setRestartError("network_error");
      setRestarting(false);
    }
  }, [slug]);

  return { pending, restarting, restartError, restart };
}
