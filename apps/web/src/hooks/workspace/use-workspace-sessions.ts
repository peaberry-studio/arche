"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listSessionFamilyAction,
  listSessionsAction,
  createSessionAction,
  deleteSessionAction,
  markFlowRunSeenAction,
  updateSessionAction,
} from "@/actions/opencode";
import type { WorkspaceSession } from "@/lib/opencode/types";
import {
  ROOT_SESSION_LIMIT_STEP,
} from "@/hooks/workspace/workspace-types";
import {
  collectLoadedFamilyIds,
  createSessionStore,
  deriveVisibleSessions,
  mergeSessionFamily,
  prependSession,
  removeSessionFamily,
  replaceRootSessions,
  updateSessionById,
  type WorkspaceSessionStore,
} from "@/hooks/workspace/workspace-session-store";

type UseWorkspaceSessionsOptions = {
  slug: string;
  initialSessionId?: string | null;
  isConnected: boolean;
};

export type DeleteWorkspaceSessionResult = {
  deletedSessionIds: Set<string>;
};

export function useWorkspaceSessions({
  slug,
  initialSessionId = null,
  isConnected,
}: UseWorkspaceSessionsOptions) {
  const initialSessionIdRef = useRef(initialSessionId);

  const [sessionStore, setSessionStore] = useState<WorkspaceSessionStore>(() => createSessionStore());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isInitialSessionsReady, setIsInitialSessionsReady] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [unseenCompletedSessions, setUnseenCompletedSessions] = useState<Set<string>>(new Set());

  const activeSessionIdRef = useRef(activeSessionId);
  const sessionStoreRef = useRef(sessionStore);
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  const sessionMutationVersionRef = useRef(0);
  const sessionLoadPromiseRef = useRef<Promise<void> | null>(null);
  const loadSessionsRef = useRef<(() => Promise<void>) | null>(null);
  const sessionFamilyLoadRequestIdRef = useRef(0);
  const hasLoadedInitialSessionsRef = useRef(false);
  const rootSessionLimitRef = useRef(ROOT_SESSION_LIMIT_STEP);

  const markSessionsMutated = useCallback(() => {
    sessionMutationVersionRef.current += 1;
    return sessionMutationVersionRef.current;
  }, []);

  const sessions = useMemo(
    () => deriveVisibleSessions(sessionStore),
    [sessionStore]
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionStoreRef.current = sessionStore;
  }, [sessionStore]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const loadSessions = useCallback(() => {
    if (sessionLoadPromiseRef.current) {
      return sessionLoadPromiseRef.current;
    }

    let finishLoad = () => {};
    const loadPromise = new Promise<void>((resolve) => {
      finishLoad = () => resolve();
    });
    sessionLoadPromiseRef.current = loadPromise;

    void (async () => {
      const isInitialLoad = !hasLoadedInitialSessionsRef.current;
      let shouldReload = false;

      setIsLoadingSessions(true);
      try {
        const mutationVersionAtStart = sessionMutationVersionRef.current;
        const currentSessionId = activeSessionIdRef.current;
        const requestedSessionId = initialSessionIdRef.current;
        // The active conversation is only ever an explicit selection: the
        // current state, or the requested deep link. Sessions never
        // auto-select; without an explicit selection the workspace shows the
        // empty state.
        const preferredSessionId = currentSessionId ?? requestedSessionId ?? null;
        const rootSessionLimit = Math.max(
          ROOT_SESSION_LIMIT_STEP,
          rootSessionLimitRef.current,
          sessionStoreRef.current.rootOrder.length,
        );
        const result = await listSessionsAction(slug, {
          limit: rootSessionLimit,
          rootsOnly: true,
        });

        if (mutationVersionAtStart !== sessionMutationVersionRef.current) {
          shouldReload = true;
          return;
        }

        if (!result.ok || !result.sessions) {
          if (isInitialLoad) {
            setSessionsError(result.error ?? "load_failed");
          }
          return;
        }

        let familySessions: WorkspaceSession[] = [];
        let familyRootId: string | null = null;
        if (
          preferredSessionId &&
          sessionStoreRef.current.loadedFamilySessionIds.has(preferredSessionId)
        ) {
          // Keep the previously loaded family visible if the refresh races or fails.
          familySessions = [...sessionStoreRef.current.loadedFamilySessionIds]
            .map((id) => sessionStoreRef.current.sessionsById[id])
            .filter((session): session is WorkspaceSession => Boolean(session));
          familyRootId = sessionStoreRef.current.loadedFamilyRootId;
        }

        if (preferredSessionId) {
          const familyResult = await listSessionFamilyAction(slug, preferredSessionId);
          if (familyResult.ok && familyResult.sessions) {
            familySessions = familyResult.sessions;
            familyRootId = familyResult.rootSessionId ?? familyRootId;
          }
        }

        if (mutationVersionAtStart !== sessionMutationVersionRef.current) {
          shouldReload = true;
          return;
        }

        const nextFamilyRootId = familySessions.length > 0
          ? familyRootId ?? preferredSessionId
          : null;
        const nextStore = nextFamilyRootId
          ? mergeSessionFamily(
              replaceRootSessions(sessionStoreRef.current, result.sessions),
              nextFamilyRootId,
              familySessions
            )
          : replaceRootSessions(sessionStoreRef.current, result.sessions);
        const visibleSessions = deriveVisibleSessions(nextStore);

        setSessionStore(nextStore);
        sessionStoreRef.current = nextStore;
        rootSessionLimitRef.current = rootSessionLimit;
        setHasMoreSessions(Boolean(result.hasMore));

        const sessionIds = new Set(visibleSessions.map((session) => session.id));

        const nextActiveSessionId =
          (currentSessionId && sessionIds.has(currentSessionId)
            ? currentSessionId
            : null) ??
          (requestedSessionId && sessionIds.has(requestedSessionId)
            ? requestedSessionId
            : null);

        initialSessionIdRef.current = null;

        if (nextActiveSessionId !== currentSessionId) {
          activeSessionIdRef.current = nextActiveSessionId;
          setActiveSessionId(nextActiveSessionId);
        }

        if (isInitialLoad) {
          hasLoadedInitialSessionsRef.current = true;
          setIsInitialSessionsReady(true);
          setSessionsError(null);
        }
        return;
      } catch (error) {
        if (isInitialLoad) {
          setSessionsError(error instanceof Error ? error.message : "load_failed");
        }
      } finally {
        if (sessionLoadPromiseRef.current === loadPromise) {
          setIsLoadingSessions(false);
          sessionLoadPromiseRef.current = null;
          if (shouldReload) {
            queueMicrotask(() => {
              void loadSessionsRef.current?.();
            });
          }
        }
        finishLoad();
      }
    })();

    return loadPromise;
  }, [slug]);

  useEffect(() => {
    loadSessionsRef.current = loadSessions;
  }, [loadSessions]);

  const loadMoreSessions = useCallback(async () => {
    if (!isConnected || isLoadingMoreSessions || !hasMoreSessions) {
      return;
    }

    const nextLimit = Math.max(
      rootSessionLimitRef.current + ROOT_SESSION_LIMIT_STEP,
      sessionStoreRef.current.rootOrder.length + ROOT_SESSION_LIMIT_STEP,
    );

    setIsLoadingMoreSessions(true);
    try {
      const result = await listSessionsAction(slug, {
        limit: nextLimit,
        rootsOnly: true,
      });
      if (!result.ok) {
        console.error("[useWorkspace] loadMoreSessions failed", result.error);
        setHasMoreSessions(false);
        return;
      }

      if (!result.sessions || result.sessions.length === 0) {
        setHasMoreSessions(false);
        return;
      }

      setSessionStore((prev) => replaceRootSessions(prev, result.sessions!));
      rootSessionLimitRef.current = nextLimit;
      setHasMoreSessions(Boolean(result.hasMore));
    } finally {
      setIsLoadingMoreSessions(false);
    }
  }, [hasMoreSessions, isConnected, isLoadingMoreSessions, slug]);

  const ensureSessionFamilyLoaded = useCallback(
    async (sessionId: string) => {
      if (sessionStoreRef.current.loadedFamilySessionIds.has(sessionId)) {
        return;
      }

      const requestId = sessionFamilyLoadRequestIdRef.current + 1;
      sessionFamilyLoadRequestIdRef.current = requestId;

      const result = await listSessionFamilyAction(slug, sessionId);
      if (requestId !== sessionFamilyLoadRequestIdRef.current) {
        return;
      }

      if (!result.ok || !result.sessions) {
        return;
      }

      const rootSessionId = result.rootSessionId ?? sessionId;
      setSessionStore((prev) => mergeSessionFamily(prev, rootSessionId, result.sessions!));
    },
    [slug]
  );

  const updateVisibleSessions = useCallback(
    (updater: (sessions: WorkspaceSession[]) => WorkspaceSession[]) => {
      setSessionStore((prev) => {
        const nextSessions = updater(deriveVisibleSessions(prev));
        let next = prev;
        for (const session of nextSessions) {
          next = updateSessionById(next, session.id, () => session);
        }
        return next;
      });
    },
    []
  );

  const selectSession = useCallback(
    (id: string | null) => {
      activeSessionIdRef.current = id;
      setActiveSessionId(id);

      if (id === null) return;

      void ensureSessionFamilyLoaded(id);

      // Clear "unseen completed" flag when the user visits this session
      setUnseenCompletedSessions((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [ensureSessionFamilyLoaded]
  );

  const markSessionCompleted = useCallback((sessionId: string) => {
    setUnseenCompletedSessions((prev) => {
      if (prev.has(sessionId)) return prev;
      return new Set(prev).add(sessionId);
    });
  }, []);

  const markFlowRunSeen = useCallback(
    async (runId: string) => {
      let touched = false;

      updateVisibleSessions((prev) =>
        prev.map((session) => {
          if (session.flow?.runId !== runId || !session.flow.hasUnseenResult) {
            return session;
          }

          touched = true;
          return {
            ...session,
            flow: {
              ...session.flow,
              hasUnseenResult: false,
            },
          };
        })
      );

      const result = await markFlowRunSeenAction(slug, runId);
      if (!result.ok && touched) {
        void loadSessions();
      }
    },
    [loadSessions, slug, updateVisibleSessions]
  );

  const createSession = useCallback(
    async (title?: string) => {
      const result = await createSessionAction(slug, title);
      if (result.ok && result.session) {
        markSessionsMutated();
        setSessionStore((prev) => prependSession(prev, result.session!));
        activeSessionIdRef.current = result.session.id;
        setActiveSessionId(result.session.id);
        if (!hasLoadedInitialSessionsRef.current) {
          setIsInitialSessionsReady(true);
        }
        return result.session;
      }
      return null;
    },
    [markSessionsMutated, slug]
  );

  const deleteSession = useCallback(
    async (id: string): Promise<DeleteWorkspaceSessionResult | null> => {
      const result = await deleteSessionAction(slug, id);
      if (result.ok) {
        markSessionsMutated();
        const sessionIdsToRemove = collectLoadedFamilyIds(sessionStoreRef.current, id);
        const nextStore = removeSessionFamily(sessionStoreRef.current, id);

        setSessionStore(nextStore);
        sessionStoreRef.current = nextStore;

        // Deleting the active conversation leaves nothing selected; the
        // workspace returns to the empty state instead of auto-opening a
        // neighbor.
        const nextActiveSessionId = activeSessionIdRef.current && sessionIdsToRemove.has(activeSessionIdRef.current)
          ? null
          : activeSessionIdRef.current;
        activeSessionIdRef.current = nextActiveSessionId;
        setActiveSessionId(nextActiveSessionId);
        if (!hasLoadedInitialSessionsRef.current) {
          setIsInitialSessionsReady(true);
        }
        return { deletedSessionIds: sessionIdsToRemove };
      }
      return null;
    },
    [markSessionsMutated, slug]
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return false;

      markSessionsMutated();
      const result = await updateSessionAction(slug, id, nextTitle);
      if (result.ok) {
        updateVisibleSessions((prev) =>
          prev.map((session) => {
            if (session.id !== id) return session;

            return {
              ...session,
              ...(result.session ?? {}),
              title: nextTitle,
            };
          })
        );
        return true;
      }

      // On failure, re-sync from backend to restore the real state.
      void loadSessions();
      return false;
    },
    [loadSessions, markSessionsMutated, slug, updateVisibleSessions]
  );

  return {
    sessionStore,
    sessions,
    activeSessionId,
    activeSession,
    activeSessionIdRef,
    sessionsRef,
    isLoadingSessions,
    isInitialSessionsReady,
    sessionsError,
    isLoadingMoreSessions,
    hasMoreSessions,
    unseenCompletedSessions,
    loadSessions,
    loadMoreSessions,
    ensureSessionFamilyLoaded,
    selectSession,
    markSessionCompleted,
    markFlowRunSeen,
    createSession,
    deleteSession,
    renameSession,
  };
}
