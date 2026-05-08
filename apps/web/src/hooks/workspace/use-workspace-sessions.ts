"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listSessionFamilyAction,
  listSessionsAction,
  createSessionAction,
  deleteSessionAction,
  markAutopilotRunSeenAction,
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
  getActiveSessionStorageKey,
  loadStoredActiveSessionId,
  mergeSessionFamily,
  persistActiveSessionId,
  prependSession,
  removeSessionFamily,
  replaceRootSessions,
  updateSessionById,
  type WorkspaceSessionStore,
} from "@/hooks/workspace/workspace-session-store";

type UseWorkspaceSessionsOptions = {
  slug: string;
  storageScope?: string;
  initialSessionId?: string | null;
  isConnected: boolean;
};

export type DeleteWorkspaceSessionResult = {
  deletedSessionIds: Set<string>;
};

export function useWorkspaceSessions({
  slug,
  storageScope,
  initialSessionId = null,
  isConnected,
}: UseWorkspaceSessionsOptions) {
  const activeSessionStorageKey = getActiveSessionStorageKey(storageScope ?? slug);
  const initialSessionIdRef = useRef(initialSessionId);

  const [sessionStore, setSessionStore] = useState<WorkspaceSessionStore>(() => createSessionStore());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [unseenCompletedSessions, setUnseenCompletedSessions] = useState<Set<string>>(new Set());

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionStoreRef = useRef(sessionStore);
  sessionStoreRef.current = sessionStore;
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  const sessionMutationVersionRef = useRef(0);
  const sessionLoadRequestIdRef = useRef(0);
  const sessionFamilyLoadRequestIdRef = useRef(0);
  const rootSessionLimitRef = useRef(ROOT_SESSION_LIMIT_STEP);

  const markSessionsMutated = useCallback(() => {
    sessionMutationVersionRef.current += 1;
    return sessionMutationVersionRef.current;
  }, []);

  const sessions = useMemo(
    () => deriveVisibleSessions(sessionStore),
    [sessionStore]
  );
  sessionsRef.current = sessions;

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const loadSessions = useCallback(async () => {
    const requestId = sessionLoadRequestIdRef.current + 1;
    sessionLoadRequestIdRef.current = requestId;
    const mutationVersionAtStart = sessionMutationVersionRef.current;
    const currentSessionId = activeSessionIdRef.current;
    const requestedSessionId = initialSessionIdRef.current;
    const storedSessionId = loadStoredActiveSessionId(activeSessionStorageKey);
    const preferredSessionId =
      currentSessionId ?? requestedSessionId ?? storedSessionId ?? null;

    setIsLoadingSessions(true);
    try {
      const rootSessionLimit = Math.max(
        ROOT_SESSION_LIMIT_STEP,
        rootSessionLimitRef.current,
        sessionStoreRef.current.rootOrder.length,
      );
      const result = await listSessionsAction(slug, {
        limit: rootSessionLimit,
        rootsOnly: true,
      });
      if (result.ok && result.sessions) {
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

        if (requestId !== sessionLoadRequestIdRef.current) {
          return;
        }

        if (mutationVersionAtStart !== sessionMutationVersionRef.current) {
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

        const firstManualRootSession = visibleSessions.find(
          (session) =>
            (!session.parentId || !sessionIds.has(session.parentId)) &&
            !session.autopilot
        );
        const firstRootSession = visibleSessions.find(
          (session) => !session.parentId || !sessionIds.has(session.parentId)
        );
        const nextActiveSessionId =
          (currentSessionId && sessionIds.has(currentSessionId)
            ? currentSessionId
            : null) ??
          (requestedSessionId && sessionIds.has(requestedSessionId)
            ? requestedSessionId
            : null) ??
          (storedSessionId && sessionIds.has(storedSessionId)
            ? storedSessionId
            : null) ??
          firstManualRootSession?.id ??
          firstRootSession?.id ??
          visibleSessions[0]?.id ??
          null;

        initialSessionIdRef.current = null;

        if (nextActiveSessionId !== currentSessionId) {
          setActiveSessionId(nextActiveSessionId);
        }
      }
    } finally {
      if (requestId === sessionLoadRequestIdRef.current) {
        setIsLoadingSessions(false);
      }
    }
  }, [activeSessionStorageKey, slug]);

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

  const markAutopilotRunSeen = useCallback(
    async (runId: string) => {
      let touched = false;

      updateVisibleSessions((prev) =>
        prev.map((session) => {
          if (session.autopilot?.runId !== runId || !session.autopilot.hasUnseenResult) {
            return session;
          }

          touched = true;
          return {
            ...session,
            autopilot: {
              ...session.autopilot,
              hasUnseenResult: false,
            },
          };
        })
      );

      const result = await markAutopilotRunSeenAction(slug, runId);
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
        setActiveSessionId(result.session.id);
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
        const nextVisibleSessions = deriveVisibleSessions(nextStore);

        setSessionStore(nextStore);
        sessionStoreRef.current = nextStore;

        const nextActiveSessionId = activeSessionIdRef.current && sessionIdsToRemove.has(activeSessionIdRef.current)
          ? nextVisibleSessions[0]?.id ?? null
          : activeSessionIdRef.current;
        setActiveSessionId(nextActiveSessionId);
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

  // Persist active session to storage
  useEffect(() => {
    persistActiveSessionId(activeSessionStorageKey, activeSessionId);
  }, [activeSessionId, activeSessionStorageKey]);

  return {
    sessionStore,
    sessions,
    activeSessionId,
    activeSession,
    activeSessionIdRef,
    sessionsRef,
    isLoadingSessions,
    isLoadingMoreSessions,
    hasMoreSessions,
    unseenCompletedSessions,
    loadSessions,
    loadMoreSessions,
    ensureSessionFamilyLoaded,
    selectSession,
    markSessionCompleted,
    markAutopilotRunSeen,
    createSession,
    deleteSession,
    renameSession,
  };
}
