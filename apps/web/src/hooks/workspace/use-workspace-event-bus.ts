"use client";

/* eslint-disable react-hooks/set-state-in-effect -- the persistent bus loop
   writes store state from its own async continuation, never synchronously from
   an event handler. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

import { listMessagesAction, listPermissionsAction } from "@/actions/opencode";
import { EMPTY_WORKSPACE_MESSAGES } from "@/hooks/workspace/workspace-types";
import {
  createEmptyChatStore,
  hydratePermissionsIntoStore,
  hydrateSessionIntoStore,
  reduceOpenCodeEvent,
  type ChatStore,
  type SessionRuntimeStatus,
} from "@/lib/opencode/event-reducer";
import type { WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";
import { isRecord } from "@/lib/records";
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from "@/lib/sse-parser";

const BUS_RECONNECT_BASE_DELAY_MS = 1_000;
const BUS_RECONNECT_MAX_DELAY_MS = 30_000;
const WORKSPACE_REFRESH_DEBOUNCE_MS = 250;

type UseWorkspaceEventBusOptions = {
  slug: string;
  getActiveSessionId: () => string | null;
  getSessions: () => WorkspaceSession[];
  refreshDiffs: () => void;
  refreshFiles: () => Promise<void>;
  syncRuntimeMetadataForSession?: (sessionId: string, items: WorkspaceMessage[]) => void;
  onBackgroundSessionIdle?: (sessionId: string) => void;
};

function parseSseEvent(data: string): { type: string; properties?: Record<string, unknown> } | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    if (!isRecord(parsed)) return null;
    return {
      type: typeof parsed.type === "string" ? parsed.type : "",
      ...(isRecord(parsed.properties) ? { properties: parsed.properties } : {}),
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the workspace ChatStore: messages, session status, and permissions are
 * all read from here. A single persistent SSE pipe to the BFF applies OpenCode
 * events through the pure reducer; a hydration pass runs on connect and on
 * each reconnect. OpenCode is the source of truth for completion.
 */
export function useWorkspaceEventBus({
  slug,
  getActiveSessionId,
  getSessions,
  refreshDiffs,
  refreshFiles,
  syncRuntimeMetadataForSession,
  onBackgroundSessionIdle,
}: UseWorkspaceEventBusOptions) {
  const [store, setStore] = useState<ChatStore>(() => createEmptyChatStore());
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isBusConnected, setIsBusConnected] = useState(false);

  const storeRef = useRef<ChatStore>(createEmptyChatStore());
  const getStore = useCallback((): ChatStore => storeRef.current, []);
  const commitStore = useCallback((updater: SetStateAction<ChatStore>) => {
    const prev = storeRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    storeRef.current = next;
    setStore(next);
  }, []);

  const activeSessionIdGetterRef = useRef(getActiveSessionId);
  const sessionsGetterRef = useRef(getSessions);
  useEffect(() => { activeSessionIdGetterRef.current = getActiveSessionId; }, [getActiveSessionId]);
  useEffect(() => { sessionsGetterRef.current = getSessions; }, [getSessions]);

  const workspaceRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshTimeoutRef.current) return;
    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      refreshDiffs();
      void refreshFiles();
    }, WORKSPACE_REFRESH_DEBOUNCE_MS);
  }, [refreshDiffs, refreshFiles]);

  const mergeHydratedMessages = useCallback(
    (sessionId: string, hydrated: WorkspaceMessage[]) => {
      commitStore((prev) => hydrateSessionIntoStore(prev, sessionId, hydrated));
      syncRuntimeMetadataForSession?.(sessionId, hydrated);
    },
    [commitStore, syncRuntimeMetadataForSession],
  );

  const setSessionStatus = useCallback(
    (sessionId: string, status: SessionRuntimeStatus) => {
      commitStore((prev) => ({
        ...prev,
        sessionStatus: { ...prev.sessionStatus, [sessionId]: status },
      }));
    },
    [commitStore],
  );

  const hydrateSessionMessages = useCallback(
    async (sessionId: string) => {
      setIsLoadingMessages(true);
      const statusBefore = getStore().sessionStatus[sessionId];
      try {
        const result = await listMessagesAction(slug, sessionId);
        if (result.ok && result.messages) {
          mergeHydratedMessages(sessionId, result.messages);
        }
        if (
          result.ok &&
          (result.sessionRuntimeStatus === "idle" || result.sessionRuntimeStatus === "busy")
        ) {
          const snapshotStatus = result.sessionRuntimeStatus;
          commitStore((prev) => {
            if (prev.sessionStatus[sessionId] !== statusBefore) return prev;
            return {
              ...prev,
              sessionStatus: { ...prev.sessionStatus, [sessionId]: snapshotStatus },
            };
          });
        }
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [slug, mergeHydratedMessages, getStore, commitStore],
  );

  const hydrateWorkspacePermissions = useCallback(async () => {
    const baseline = getStore().permissions;
    const result = await listPermissionsAction(slug);
    if (!result.ok || !result.permissions) return;
    const snapshot = result.permissions;
    commitStore((current) => hydratePermissionsIntoStore(current, snapshot, baseline));
  }, [commitStore, getStore, slug]);

  const hydrateOnConnect = useCallback(async () => {
    const sessionId = activeSessionIdGetterRef.current();
    await Promise.all([
      sessionId ? hydrateSessionMessages(sessionId) : Promise.resolve(),
      hydrateWorkspacePermissions(),
    ]);
  }, [hydrateSessionMessages, hydrateWorkspacePermissions]);

  const refreshMessages = useCallback(
    async (sessionIdOverride?: string) => {
      const sessionId = sessionIdOverride ?? activeSessionIdGetterRef.current();
      if (!sessionId) return;
      await hydrateSessionMessages(sessionId);
    },
    [hydrateSessionMessages],
  );

  // Held in a ref so the reconnect loop does not restart when hydration is
  // re-created; the loop calls it on connect and on every reconnect.
  const hydrateOnConnectRef = useRef(hydrateOnConnect);
  useEffect(() => {
    hydrateOnConnectRef.current = hydrateOnConnect;
  }, [hydrateOnConnect]);

  const updateMessages = useCallback(
    (sessionId: string, updater: SetStateAction<WorkspaceMessage[]>) => {
      commitStore((prev) => {
        const current = prev.messages[sessionId] ?? EMPTY_WORKSPACE_MESSAGES;
        const nextMessages = typeof updater === "function" ? updater(current) : updater;
        return {
          ...prev,
          messages: { ...prev.messages, [sessionId]: nextMessages },
        };
      });
    },
    [commitStore],
  );

  const removeSessionEntries = useCallback((sessionIds: Set<string>) => {
    commitStore((prev) => {
      const messages = { ...prev.messages };
      const sessionStatus = { ...prev.sessionStatus };
      const permissions = { ...prev.permissions };
      const pendingParts = { ...prev.pendingParts };
      for (const sessionId of sessionIds) {
        for (const message of prev.messages[sessionId] ?? []) {
          delete pendingParts[message.id];
        }
        delete messages[sessionId];
        delete sessionStatus[sessionId];
        delete permissions[sessionId];
      }
      return { ...prev, messages, sessionStatus, permissions, pendingParts };
    });
  }, [commitStore]);

  const dispatchReducerEvent = useCallback(
    (event: { type: string; properties?: Record<string, unknown> }) => {
      const previousStatuses = getStore().sessionStatus;
      const result = reduceOpenCodeEvent(getStore(), event);
      commitStore(result.store);
      if (result.workspaceTouched) {
        scheduleWorkspaceRefresh();
      }
      const activeId = activeSessionIdGetterRef.current();
      for (const [sessionId, status] of Object.entries(result.store.sessionStatus)) {
        if (
          sessionId !== activeId &&
          previousStatuses[sessionId] === "busy" &&
          status === "idle"
        ) {
          onBackgroundSessionIdle?.(sessionId);
        }
      }
    },
    [getStore, commitStore, onBackgroundSessionIdle, activeSessionIdGetterRef, scheduleWorkspaceRefresh],
  );

  const runBusEventLoop = useCallback(async (signal: AbortSignal) => {
    let delay = BUS_RECONNECT_BASE_DELAY_MS;
    while (!signal.aborted) {
      try {
        const response = await fetch(`/api/w/${slug}/events`, { signal });
        if (!response.ok || !response.body) {
          throw new Error("event_stream_unavailable");
        }
        setIsBusConnected(true);
        delay = BUS_RECONNECT_BASE_DELAY_MS;

        // Hydrate messages, permissions, and session status on every successful
        // connect (initial and reconnects). OpenCode keeps running while the
        // pipe is down; the hydrate merges the server state into what the bus
        // already applied.
        void hydrateOnConnectRef.current();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let parseState = INITIAL_SSE_PARSE_STATE;

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = parseSseChunk(parseState, decoder.decode(value, { stream: true }));
          parseState = parsed.state;
          for (const parsedEvent of parsed.events) {
            const event = parseSseEvent(parsedEvent.data);
            if (event) dispatchReducerEvent(event);
          }
        }
        if (signal.aborted) return;
        // Clean EOF counts as a disconnect: mark it, back off, reconnect.
        setIsBusConnected(false);
        await sleep(delay);
        delay = Math.min(delay * 2, BUS_RECONNECT_MAX_DELAY_MS);
      } catch {
        if (signal.aborted) return;
        setIsBusConnected(false);
        await sleep(delay);
        delay = Math.min(delay * 2, BUS_RECONNECT_MAX_DELAY_MS);
      }
    }
  }, [slug, dispatchReducerEvent]);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    void runBusEventLoop(controller.signal);
    return () => {
      controller.abort();
    };
  }, [slug, runBusEventLoop]);

  return {
    store,
    storeRef,
    getStore,
    commitStore,
    isLoadingMessages,
    isBusConnected,
    refreshMessages,
    updateMessages,
    setSessionStatus,
    removeSessionEntries,
    dispatchReducerEvent,
    activeSessionIdGetterRef,
  };
}
