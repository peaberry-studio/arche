"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkConnectionAction } from "@/actions/opencode";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export type UseWorkspaceConnectionReturn = {
  connection: WorkspaceConnectionState;
  isConnected: boolean;
};

/**
 * Manages workspace connection state: initial check with exponential-backoff
 * retry, and optionally fires an `onConnected` callback once the connection succeeds.
 *
 * The `onConnected` callback is stored in a ref so identity changes do not
 * restart the init effect.
 */
export function useWorkspaceConnection(
  slug: string,
  enabled: boolean,
  onConnected?: () => Promise<void> | void,
): UseWorkspaceConnectionReturn {
  const [connection, setConnection] = useState<WorkspaceConnectionState>({
    status: "connecting",
  });

  const isConnected = connection.status === "connected";

  // Keep onConnected in a ref so the init effect does not re-fire when the
  // caller's callback identity changes (which it inevitably will because the
  // caller closes over state that changes after init loads data).
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const checkConnection = useCallback(async () => {
    const result = await checkConnectionAction(slug);
    setConnection(result);
    return result.status === "connected";
  }, [slug]);

  // Initial connection check with retry
  useEffect(() => {
    if (!enabled) {
      setConnection({ status: "connecting" });
      return;
    }

    let mounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    async function init() {
      const connected = await checkConnection();
      if (!mounted) return;

      if (connected) {
        retryCount = 0;
        await onConnectedRef.current?.();
      } else if (retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, retryCount - 1),
          MAX_DELAY_MS,
        );
        console.log(
          `[useWorkspaceConnection] Connection failed, retrying in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`,
        );
        retryTimeout = setTimeout(() => {
          if (mounted) init();
        }, delay);
      } else {
        console.log(
          "[useWorkspaceConnection] Max retries reached, giving up",
        );
      }
    }

    init();

    return () => {
      mounted = false;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [checkConnection, enabled]);

  return { connection, isConnected };
}
