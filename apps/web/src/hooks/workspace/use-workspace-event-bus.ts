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

import { listMessagesAction } from "@/actions/opencode";
import {
  createEmptyChatStore,
  reduceOpenCodeEvent,
  type ChatStore,
  type SessionRuntimeStatus,
} from "@/lib/opencode/event-reducer";
import type { WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from "@/lib/sse-parser";
import { EMPTY_WORKSPACE_MESSAGES } from "@/hooks/workspace/workspace-types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
    setStore((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      storeRef.current = next;
      return next;
    });
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
      const current = getStore().messages[sessionId] ?? EMPTY_WORKSPACE_MESSAGES;
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of hydrated) {
        byId.set(message.id, message);
      }

      // Drop an optimistic user message only once a confirmed server message
      // carries the same text under a different id. A hydrate that races a
      // send (server still processing) must keep the in-flight optimistic.
      const optimisticIds = getStore().optimisticUserIds[sessionId] ?? [];
      const confirmedText = new Set(
        hydrated.filter((message) => message.role === "user").map((message) => message.content),
      );
      const droppedOptimisticIds = new Set<string>();
      for (const id of optimisticIds) {
        const optimistic = byId.get(id);
        if (!optimistic) continue;
        if (
          hydrated.some((message) => message.id === id) ||
          confirmedText.has(optimistic.content)
        ) {
          byId.delete(id);
          droppedOptimisticIds.add(id);
        }
      }

      const merged = Array.from(byId.values());
      setStore((prev) => {
        const remainingOptimisticIds = (prev.optimisticUserIds[sessionId] ?? []).filter(
          (id) => !droppedOptimisticIds.has(id),
        );
        const nextOptimisticUserIds = { ...prev.optimisticUserIds };
        if (remainingOptimisticIds.length === 0) {
          delete nextOptimisticUserIds[sessionId];
        } else {
          nextOptimisticUserIds[sessionId] = remainingOptimisticIds;
        }
        const migrated = {
          ...prev,
          messages: { ...prev.messages, [sessionId]: merged },
          optimisticUserIds: nextOptimisticUserIds,
        };
        storeRef.current = migrated;
        return migrated;
      });
      syncRuntimeMetadataForSession?.(sessionId, hydrated);
    },
    [getStore, syncRuntimeMetadataForSession],
  );

  const hydrateSessionMessages = useCallback(
    async (sessionId: string) => {
      setIsLoadingMessages(true);
      try {
        const result = await listMessagesAction(slug, sessionId);
        if (result.ok && result.messages) {
          mergeHydratedMessages(sessionId, result.messages);
        }
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [slug, mergeHydratedMessages],
  );

  const refreshMessages = useCallback(
    async (sessionIdOverride?: string) => {
      const sessionId = sessionIdOverride ?? activeSessionIdGetterRef.current();
      if (!sessionId) return;
      await hydrateSessionMessages(sessionId);
    },
    [activeSessionIdGetterRef, hydrateSessionMessages],
  );

  // Held in a ref so the reconnect loop does not restart when hydration is
  // re-created; the loop calls it on connect and on every reconnect.
  const refreshMessagesRef = useRef(refreshMessages);
  useEffect(() => {
    refreshMessagesRef.current = refreshMessages;
  }, [refreshMessages]);

  const updateMessages = useCallback(
    (sessionId: string, updater: SetStateAction<WorkspaceMessage[]>) => {
      const current = getStore().messages[sessionId] ?? EMPTY_WORKSPACE_MESSAGES;
      const nextMessages = typeof updater === "function" ? updater(current) : updater;
      setStore((prev) => {
        const next = {
          ...prev,
          messages: { ...prev.messages, [sessionId]: nextMessages },
        };
        storeRef.current = next;
        return next;
      });
    },
    [getStore],
  );

  const setSessionStatus = useCallback(
    (sessionId: string, status: SessionRuntimeStatus) => {
      setStore((prev) => {
        const next = {
          ...prev,
          sessionStatus: { ...prev.sessionStatus, [sessionId]: status },
        };
        storeRef.current = next;
        return next;
      });
    },
    [],
  );

  const removeSessionEntries = useCallback((sessionIds: Set<string>) => {
    setStore((prev) => {
      const messages = { ...prev.messages };
      const sessionStatus = { ...prev.sessionStatus };
      const permissions = { ...prev.permissions };
      const optimisticUserIds = { ...prev.optimisticUserIds };
      for (const sessionId of sessionIds) {
        delete messages[sessionId];
        delete sessionStatus[sessionId];
        delete permissions[sessionId];
        delete optimisticUserIds[sessionId];
      }
      const next = { ...prev, messages, sessionStatus, permissions, optimisticUserIds };
      storeRef.current = next;
      return next;
    });
  }, []);

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

        // Hydrate the active session on every successful connect (initial and
        // reconnects). OpenCode keeps running while the pipe is down; the
        // hydrate merges the server state into what the bus already applied.
        void refreshMessagesRef.current();

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
