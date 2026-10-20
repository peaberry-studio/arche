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

import { listMessagesAction, listPermissionsAction } from "@/actions/workspace-sessions";
import { EMPTY_WORKSPACE_MESSAGES } from "@/hooks/workspace/workspace-types";
import type { ArcheEvent } from "@/lib/harness/events";
import { KNOWLEDGE_PROPOSALS_CHANGED_EVENT } from "@/lib/runtime/workspace-broadcast-events";
import { INITIAL_SSE_PARSE_STATE, parseSseChunk } from "@/lib/sse-parser";
import { parseArcheEvent } from "@/lib/workspace-events/parse-event";
import {
  createEmptyChatStore,
  hydratePermissionsIntoStore,
  hydrateSessionIntoStore,
  reduceArcheEvent,
  type ChatStore,
  type SessionRuntimeStatus,
} from "@/lib/workspace-events/reducer";
import type { WorkspaceMessage, WorkspaceSession } from "@/types/workspace-runtime";

const BUS_RECONNECT_BASE_DELAY_MS = 1_000;
const BUS_RECONNECT_MAX_DELAY_MS = 30_000;
const WORKSPACE_REFRESH_DEBOUNCE_MS = 250;
const KNOWLEDGE_REFRESH_DEBOUNCE_MS = 500;

type UseWorkspaceEventBusOptions = {
  slug: string;
  getActiveSessionId: () => string | null;
  getSessions: () => WorkspaceSession[];
  refreshDiffs: () => void;
  refreshFiles: () => Promise<void>;
  syncRuntimeMetadataForSession?: (sessionId: string, items: WorkspaceMessage[]) => void;
  onBackgroundSessionIdle?: (sessionId: string) => void;
  onKnowledgeProposalsChanged?: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the workspace ChatStore: messages, session status, and permissions are
 * all read from here. A single persistent SSE pipe to the BFF applies Arche
 * events through the pure reducer; a hydration pass runs on connect and on
 * each reconnect. The runtime is the source of truth for completion.
 */
export function useWorkspaceEventBus({
  slug,
  getActiveSessionId,
  getSessions,
  refreshDiffs,
  refreshFiles,
  syncRuntimeMetadataForSession,
  onBackgroundSessionIdle,
  onKnowledgeProposalsChanged,
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

  const hydrationScopeRef = useRef({
    slug,
    generations: new Map<string, number>(),
    archived: new Map<string, boolean>(),
    pending: new Set<string>(),
  });
  useEffect(() => {
    if (hydrationScopeRef.current.slug === slug) return;
    hydrationScopeRef.current = { slug, generations: new Map(), archived: new Map(), pending: new Set() };
    commitStore(createEmptyChatStore());
    setIsLoadingMessages(false);
    setIsBusConnected(false);
  }, [slug, commitStore]);

  const activeSessionIdGetterRef = useRef(getActiveSessionId);
  const sessionsGetterRef = useRef(getSessions);
  useEffect(() => { activeSessionIdGetterRef.current = getActiveSessionId; }, [getActiveSessionId]);
  useEffect(() => { sessionsGetterRef.current = getSessions; }, [getSessions]);

  const getArchivedSessionIds = useCallback(() => {
    const ids = new Set(sessionsGetterRef.current().filter((session) => session.archived).map((session) => session.id));
    for (const [id, archived] of hydrationScopeRef.current.archived) {
      if (archived) ids.add(id);
      else if (ids.has(id)) ids.delete(id);
      else hydrationScopeRef.current.archived.delete(id);
    }
    return ids;
  }, []);

  const workspaceRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleWorkspaceRefresh = useCallback(() => {
    if (workspaceRefreshTimeoutRef.current) return;
    workspaceRefreshTimeoutRef.current = setTimeout(() => {
      workspaceRefreshTimeoutRef.current = null;
      refreshDiffs();
      void refreshFiles();
    }, WORKSPACE_REFRESH_DEBOUNCE_MS);
  }, [refreshDiffs, refreshFiles]);

  // Held in a ref so the bus loop never restarts because the callback identity
  // changed; only the debounce timer has to survive across renders.
  const onKnowledgeProposalsChangedRef = useRef(onKnowledgeProposalsChanged);
  useEffect(() => {
    onKnowledgeProposalsChangedRef.current = onKnowledgeProposalsChanged;
  }, [onKnowledgeProposalsChanged]);

  const knowledgeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleKnowledgeProposalsRefresh = useCallback(() => {
    if (knowledgeRefreshTimeoutRef.current) return;
    knowledgeRefreshTimeoutRef.current = setTimeout(() => {
      knowledgeRefreshTimeoutRef.current = null;
      onKnowledgeProposalsChangedRef.current?.();
    }, KNOWLEDGE_REFRESH_DEBOUNCE_MS);
  }, []);

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
      const scope = hydrationScopeRef.current;
      if (scope.slug !== slug) return;
      const generation = (scope.generations.get(sessionId) ?? 0) + 1;
      scope.generations.set(sessionId, generation);
      scope.pending.add(sessionId);
      setIsLoadingMessages(true);
      const statusBefore = getStore().sessionStatus[sessionId];
      try {
        const result = await listMessagesAction(slug, sessionId);
        if (scope !== hydrationScopeRef.current || scope.generations.get(sessionId) !== generation) return;
        const wasArchived = getArchivedSessionIds().has(sessionId);
        if (result.ok && result.messages && (result.archived || wasArchived)) {
          scope.archived.set(sessionId, result.archived === true);
          const messages = result.messages;
          commitStore((prev) => {
            const pendingParts = { ...prev.pendingParts };
            for (const message of [...(prev.messages[sessionId] ?? []), ...messages]) {
              delete pendingParts[message.id];
            }
            return {
              ...prev,
              messages: { ...prev.messages, [sessionId]: messages },
              pendingParts,
              permissions: { ...prev.permissions, [sessionId]: [] },
              sessionStatus: { ...prev.sessionStatus, [sessionId]: !result.archived && result.sessionRuntimeStatus === "busy" ? "busy" : "idle" },
            };
          });
          if (!result.archived) syncRuntimeMetadataForSession?.(sessionId, messages);
          return;
        }
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
        if (scope === hydrationScopeRef.current && scope.generations.get(sessionId) === generation) {
          scope.pending.delete(sessionId);
          setIsLoadingMessages(scope.pending.size > 0);
        }
      }
    },
    [slug, mergeHydratedMessages, getArchivedSessionIds, getStore, commitStore, syncRuntimeMetadataForSession],
  );

  const hydrateWorkspacePermissions = useCallback(async () => {
    const scope = hydrationScopeRef.current;
    if (scope.slug !== slug) return;
    const baseline = getStore().permissions;
    const result = await listPermissionsAction(slug);
    if (scope !== hydrationScopeRef.current) return;
    if (!result.ok || !result.permissions) return;
    const archivedIds = getArchivedSessionIds();
    const snapshot = Object.fromEntries(Object.entries(result.permissions).filter(([id]) => !archivedIds.has(id)));
    commitStore((current) => hydratePermissionsIntoStore(current, snapshot, baseline));
  }, [commitStore, getArchivedSessionIds, getStore, slug]);

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
        const scope = hydrationScopeRef.current;
        scope.generations.set(sessionId, (scope.generations.get(sessionId) ?? 0) + 1);
        scope.archived.delete(sessionId);
        scope.pending.delete(sessionId);
        for (const message of prev.messages[sessionId] ?? []) {
          delete pendingParts[message.id];
        }
        delete messages[sessionId];
        delete sessionStatus[sessionId];
        delete permissions[sessionId];
      }
      return { ...prev, messages, sessionStatus, permissions, pendingParts };
    });
    setIsLoadingMessages(hydrationScopeRef.current.pending.size > 0);
  }, [commitStore]);

  const dispatchReducerEvent = useCallback(
    (event: ArcheEvent) => {
      const archivedIds = getArchivedSessionIds();
      const sessionId = "sessionId" in event ? event.sessionId
        : event.type === "session.upserted" ? event.session.id
        : event.type === "message.upserted" && "message" in event ? event.message.sessionId
        : event.type === "permission.asked" ? event.permission.sessionId
        : undefined;
      if (sessionId && archivedIds.has(sessionId)) return;
      if ("messageId" in event && [...archivedIds].some((id) => getStore().messages[id]?.some((message) => message.id === event.messageId))) return;
      const previousStatuses = getStore().sessionStatus;
      const result = reduceArcheEvent(getStore(), event);
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
    [getArchivedSessionIds, getStore, commitStore, onBackgroundSessionIdle, activeSessionIdGetterRef, scheduleWorkspaceRefresh],
  );

  const runBusEventLoop = useCallback(async (signal: AbortSignal) => {
    let delay = BUS_RECONNECT_BASE_DELAY_MS;
    while (!signal.aborted) {
      try {
        const response = await fetch(`/api/w/${slug}/events`, { signal });
        if (signal.aborted) return;
        if (!response.ok || !response.body) {
          throw new Error("event_stream_unavailable");
        }
        setIsBusConnected(true);
        delay = BUS_RECONNECT_BASE_DELAY_MS;

        // Hydrate messages, permissions, and session status on every successful
        // connect (initial and reconnects). OpenCode keeps running while the
        // pipe is down; the hydrate merges the server state into what the bus
        // already applied. The pending-proposal count refreshes on connect too,
        // recovering notifications missed while the pipe was down.
        void hydrateOnConnectRef.current();
        scheduleKnowledgeProposalsRefresh();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let parseState = INITIAL_SSE_PARSE_STATE;

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (signal.aborted) return;
          if (done) break;
          const parsed = parseSseChunk(parseState, decoder.decode(value, { stream: true }));
          parseState = parsed.state;
          for (const parsedEvent of parsed.events) {
            const event = parseArcheEvent(parsedEvent.data);
            if (!event) continue;
            // Badge notifications are intercepted before the reducer: they
            // must never mutate chat/session state.
            if (event.type === KNOWLEDGE_PROPOSALS_CHANGED_EVENT) {
              scheduleKnowledgeProposalsRefresh();
              continue;
            }
            dispatchReducerEvent(event);
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
  }, [slug, dispatchReducerEvent, scheduleKnowledgeProposalsRefresh]);

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
