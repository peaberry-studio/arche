import type { WorkspaceSession } from "@/lib/opencode/types";

export type WorkspaceSessionStore = {
  sessionsById: Record<string, WorkspaceSession>;
  visibleOrder: string[];
  rootOrder: string[];
  loadedFamilyRootId: string | null;
  loadedFamilySessionIds: ReadonlySet<string>;
};

export function createSessionStore(): WorkspaceSessionStore {
  return {
    sessionsById: {},
    visibleOrder: [],
    rootOrder: [],
    loadedFamilyRootId: null,
    loadedFamilySessionIds: new Set(),
  };
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function mergeSessionsById(
  current: Record<string, WorkspaceSession>,
  sessions: WorkspaceSession[]
): Record<string, WorkspaceSession> {
  const next = { ...current };
  for (const session of sessions) {
    next[session.id] = session;
  }
  return next;
}

function buildVisibleOrder(
  rootOrder: string[],
  loadedFamilySessionIds: ReadonlySet<string>
): string[] {
  return uniqueIds([...rootOrder, ...loadedFamilySessionIds]);
}

export function replaceRootSessions(
  store: WorkspaceSessionStore,
  sessions: WorkspaceSession[]
): WorkspaceSessionStore {
  const rootIds = sessions.map((session) => session.id);
  const loadedFamilyIds = store.loadedFamilySessionIds;
  const nextSessionsById: Record<string, WorkspaceSession> = {};

  for (const id of rootIds) {
    const session = sessions.find((candidate) => candidate.id === id);
    if (session) nextSessionsById[id] = session;
  }

  for (const id of loadedFamilyIds) {
    const session = store.sessionsById[id];
    if (session) nextSessionsById[id] = session;
  }

  return {
    ...store,
    sessionsById: nextSessionsById,
    rootOrder: rootIds,
    visibleOrder: buildVisibleOrder(rootIds, loadedFamilyIds),
  };
}

export function mergeSessionFamily(
  store: WorkspaceSessionStore,
  rootSessionId: string,
  sessions: WorkspaceSession[]
): WorkspaceSessionStore {
  const familyIds = new Set(sessions.map((session) => session.id));
  const rootOrder = store.rootOrder.includes(rootSessionId)
    ? store.rootOrder
    : uniqueIds([...store.rootOrder, rootSessionId]);

  return {
    ...store,
    sessionsById: mergeSessionsById(store.sessionsById, sessions),
    rootOrder,
    loadedFamilyRootId: rootSessionId,
    loadedFamilySessionIds: familyIds,
    visibleOrder: buildVisibleOrder(rootOrder, familyIds),
  };
}

export function prependSession(
  store: WorkspaceSessionStore,
  session: WorkspaceSession
): WorkspaceSessionStore {
  const loadedFamilySessionIds = new Set([session.id]);
  const rootOrder = uniqueIds([session.id, ...store.rootOrder]);

  return {
    ...store,
    sessionsById: {
      ...store.sessionsById,
      [session.id]: session,
    },
    rootOrder,
    loadedFamilyRootId: session.id,
    loadedFamilySessionIds,
    visibleOrder: buildVisibleOrder(rootOrder, loadedFamilySessionIds),
  };
}

export function updateSessionById(
  store: WorkspaceSessionStore,
  id: string,
  updater: (session: WorkspaceSession) => WorkspaceSession
): WorkspaceSessionStore {
  const current = store.sessionsById[id];
  if (!current) return store;

  const nextSession = updater(current);
  if (nextSession === current) return store;

  return {
    ...store,
    sessionsById: {
      ...store.sessionsById,
      [id]: nextSession,
    },
  };
}

export function collectLoadedFamilyIds(
  store: WorkspaceSessionStore,
  sessionId: string
): Set<string> {
  const familyIds = new Set<string>([sessionId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const session of Object.values(store.sessionsById)) {
      if (
        session.parentId &&
        familyIds.has(session.parentId) &&
        !familyIds.has(session.id)
      ) {
        familyIds.add(session.id);
        changed = true;
      }
    }
  }

  return familyIds;
}

export function removeSessionFamily(
  store: WorkspaceSessionStore,
  sessionId: string
): WorkspaceSessionStore {
  const idsToRemove = collectLoadedFamilyIds(store, sessionId);
  const sessionsById = { ...store.sessionsById };
  for (const id of idsToRemove) {
    delete sessionsById[id];
  }

  const rootOrder = store.rootOrder.filter((id) => !idsToRemove.has(id));
  const loadedFamilySessionIds = new Set(
    [...store.loadedFamilySessionIds].filter((id) => !idsToRemove.has(id))
  );
  const loadedFamilyRootId =
    store.loadedFamilyRootId && idsToRemove.has(store.loadedFamilyRootId)
      ? null
      : store.loadedFamilyRootId;

  return {
    sessionsById,
    rootOrder,
    loadedFamilyRootId,
    loadedFamilySessionIds,
    visibleOrder: buildVisibleOrder(rootOrder, loadedFamilySessionIds),
  };
}

export function deriveVisibleSessions(
  store: WorkspaceSessionStore
): WorkspaceSession[] {
  return store.visibleOrder
    .map((id) => store.sessionsById[id])
    .filter((session): session is WorkspaceSession => Boolean(session));
}

export function hasSession(
  store: WorkspaceSessionStore,
  id: string
): boolean {
  return id in store.sessionsById;
}

export function getActiveSessionStorageKey(scope: string): string {
  return `arche.workspace.${scope}.active-session`;
}

export function readStoredValue(storage: Storage, key: string): string | null {
  const value = storage.getItem(key);
  return value && value.trim().length > 0 ? value : null;
}

export function loadStoredActiveSessionId(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return (
      readStoredValue(window.sessionStorage, key) ??
      readStoredValue(window.localStorage, key)
    );
  } catch {
    return null;
  }
}

export function persistActiveSessionId(key: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (sessionId) {
      window.sessionStorage.setItem(key, sessionId);
      window.localStorage.setItem(key, sessionId);
      return;
    }

    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
}
