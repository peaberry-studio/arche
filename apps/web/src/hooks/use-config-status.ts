"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
  type ConfigChangeReason,
} from '@/lib/runtime/config-status-events'

type ConfigStatus = {
  /** Whether there are pending config changes that require a restart */
  pending: boolean;
  /** Why a restart is pending */
  reason: ConfigChangeReason | null;
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
  const [reason, setReason] = useState<ConfigChangeReason | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stickyPendingRef = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${slug}/config-status`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        pending?: boolean;
        reason?: 'config' | 'provider_sync' | null;
      };
      if (data.reason === 'config') {
        stickyPendingRef.current = true;
      }
      const nextReason = stickyPendingRef.current ? 'config' : data.reason ?? null;
      setReason(nextReason);
      setPending(nextReason !== null || Boolean(data.pending));
    } catch {
      // silent — polling is best-effort
    }
  }, [slug]);

  useEffect(() => {
    if (!enabled) {
      stickyPendingRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const handleConfigStatusChanged = () => {
      void checkStatus();
    };

    // Check shortly after mount, then poll at interval
    const initial = setTimeout(() => {
      void checkStatus();
    }, 0);

    window.addEventListener(WORKSPACE_CONFIG_STATUS_CHANGED_EVENT, handleConfigStatusChanged);

    intervalRef.current = setInterval(() => {
      void checkStatus();
    }, POLL_INTERVAL);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      window.removeEventListener(WORKSPACE_CONFIG_STATUS_CHANGED_EVENT, handleConfigStatusChanged);
    };
  }, [checkStatus, enabled]);

  const restart = useCallback(async () => {
    setRestarting(true);
    setRestartError(null);

    try {
      const res = await fetch(`/api/instances/${slug}/restart`, {
        method: "POST",
        cache: "no-store",
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

  return {
    pending: enabled ? pending : false,
    reason: enabled ? reason : null,
    restarting,
    restartError,
    restart,
  };
}
