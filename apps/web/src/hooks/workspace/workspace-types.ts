"use client";

import type { WorkspacePermission } from "@/lib/opencode/permission";
import type {
  AvailableModel,
  PermissionResponse,
  WorkspaceFileNode,
  WorkspaceMessage,
  WorkspaceSession,
} from "@/lib/opencode/types";
import { isProviderId, normalizeProviderId } from "@/lib/providers/catalog";
import type { MessageAttachmentInput } from "@/types/workspace";

export type { WorkspaceDiff } from "@/hooks/use-workspace-diffs";

export type AgentCatalogItem = {
  id: string;
  displayName: string;
  model?: string;
  resolvedModel?: string;
  isPrimary: boolean;
};

export type ProviderStatusEntry = {
  providerId: string;
  status: string;
};

export const ROOT_SESSION_LIMIT_STEP = 500;
export const EMPTY_WORKSPACE_MESSAGES: WorkspaceMessage[] = [];
export const PRE_SESSION_SELECTION_KEY = "__pre_session__";

export function filterModelsByProviderStatus(
  models: AvailableModel[],
  providerStatuses: ProviderStatusEntry[]
): AvailableModel[] {
  const enabledProviders = new Set(
    providerStatuses
      .filter((provider) => provider.status === "enabled")
      .map((provider) => normalizeProviderId(provider.providerId))
  );

  return models.filter((model) => {
    const normalizedProviderId = normalizeProviderId(model.providerId);
    if (!isProviderId(normalizedProviderId)) return true;
    if (normalizedProviderId === "opencode") return true;
    return enabledProviders.has(normalizedProviderId);
  });
}

export function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

export function findAgentInCatalog(
  catalog: AgentCatalogItem[],
  agentId: string
): AgentCatalogItem | undefined {
  const normalized = normalizeAgentId(agentId);
  return catalog.find((entry) => {
    if (entry.id === agentId) return true;
    return normalizeAgentId(entry.displayName) === normalized;
  });
}

export function parseModelString(
  value?: string
): { providerId: string; modelId: string } | null {
  if (!value) return null;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator >= value.length - 1) return null;

  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

export function resolveModelEntry(
  providerId: string,
  modelId: string,
  models: AvailableModel[]
): AvailableModel {
  const normalizedProviderId = normalizeProviderId(providerId);
  const match = models.find(
    (entry) =>
      normalizeProviderId(entry.providerId) === normalizedProviderId &&
      entry.modelId === modelId
  );
  if (match) return match;

  return {
    providerId,
    modelId,
    providerName: providerId,
    modelName: modelId,
    isDefault: false,
  };
}

export function hasModelEntry(
  providerId: string,
  modelId: string,
  models: AvailableModel[]
): boolean {
  const normalizedProviderId = normalizeProviderId(providerId);
  return models.some(
    (entry) =>
      normalizeProviderId(entry.providerId) === normalizedProviderId &&
      entry.modelId === modelId
  );
}

export function getPrimaryAgent(catalog: AgentCatalogItem[]): AgentCatalogItem | null {
  return catalog.find((agent) => agent.isPrimary) ?? null;
}

export function getSessionSelectionKey(sessionId: string | null): string {
  return sessionId ?? PRE_SESSION_SELECTION_KEY;
}

export type SessionSelectionState = {
  manualModel: AvailableModel | null;
  runtimeModel: AvailableModel | null;
  activeAgentId: string | null;
};

export function createDefaultSessionSelectionState(
  primaryAgentId: string | null
): SessionSelectionState {
  return {
    manualModel: null,
    runtimeModel: null,
    activeAgentId: primaryAgentId,
  };
}

export function mergeWorkspaceSessions(
  primary: WorkspaceSession[],
  secondary: WorkspaceSession[]
): WorkspaceSession[] {
  const merged = [...primary];
  const seen = new Set(primary.map((session) => session.id));

  for (const session of secondary) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    merged.push(session);
  }

  return merged;
}

export function areWorkspaceSessionListsEqual(
  left: WorkspaceSession[],
  right: WorkspaceSession[]
): boolean {
  if (left.length !== right.length) return false;

  return left.every((session, index) => {
    const candidate = right[index];
    return (
      session.id === candidate.id &&
      session.title === candidate.title &&
      session.status === candidate.status &&
      session.updatedAt === candidate.updatedAt &&
      session.updatedAtRaw === candidate.updatedAtRaw &&
      session.parentId === candidate.parentId &&
      session.flow?.runId === candidate.flow?.runId &&
      session.flow?.status === candidate.flow?.status &&
      session.flow?.hasUnseenResult === candidate.flow?.hasUnseenResult
    );
  });
}

export function removeWorkspaceSessions(
  sessions: WorkspaceSession[],
  sessionIdsToRemove: Set<string>
): WorkspaceSession[] {
  return sessions.filter((session) => !sessionIdsToRemove.has(session.id));
}

export function collectSessionFamilyIds(
  sessions: WorkspaceSession[],
  sessionId: string
): Set<string> {
  const familyIds = new Set<string>([sessionId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const session of sessions) {
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

/**
 * Pending permissions visible for a session: those belonging to the session
 * itself or to any known child (subagent) session. The bus store keeps every
 * session's permissions; the UI shows only the active family.
 */
export function selectVisiblePermissions(
  permissionsBySession: Record<string, WorkspacePermission[]>,
  sessions: WorkspaceSession[],
  activeSessionId: string | null
): WorkspacePermission[] {
  if (!activeSessionId) return [];
  const familyIds = collectSessionFamilyIds(sessions, activeSessionId);
  return Object.entries(permissionsBySession).flatMap(([sessionId, items]) =>
    familyIds.has(sessionId) ? items : [],
  );
}

export type UseWorkspaceOptions = {
  slug: string;
  storageScope?: string;
  /** Poll interval in ms for session status updates */
  pollInterval?: number;
  /** Skip connection attempts when false */
  enabled?: boolean;
  workspaceAgentEnabled?: boolean;
  /** Enable instance heartbeat for idle timeout (web mode) */
  reaperEnabled?: boolean;
};

export type UseWorkspaceReturn = {
  // Connection
  connection: import("@/lib/opencode/types").WorkspaceConnectionState;
  isConnected: boolean;

  // Files
  fileTree: WorkspaceFileNode[];
  isLoadingFiles: boolean;
  refreshFiles: () => Promise<void>;
  readFile: (
    path: string
  ) => Promise<{ content: string; type: "raw" | "patch"; hash?: string } | null>;
  writeFile: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: boolean; hash?: string; error?: string }>;
  deleteFile: (path: string) => Promise<boolean>;
  applyPatch: (patch: string) => Promise<boolean>;
  discardFileChanges: (path: string) => Promise<{ ok: boolean; error?: string }>;

  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  activeSession: WorkspaceSession | null;
  isLoadingSessions: boolean;
  isInitialSessionsReady: boolean;
  sessionsError: string | null;
  isLoadingMoreSessions: boolean;
  hasMoreSessions: boolean;
  unseenCompletedSessions: ReadonlySet<string>;
  refreshSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  selectSession: (id: string | null) => void;
  markFlowRunSeen: (runId: string) => Promise<void>;
  createSession: (title?: string) => Promise<WorkspaceSession | null>;
  deleteSession: (id: string) => Promise<boolean>;
  renameSession: (id: string, title: string) => Promise<boolean>;

  // Messages
  messages: WorkspaceMessage[];
  isLoadingMessages: boolean;
  isSending: boolean;
  isStartingNewSession: boolean;
  sendMessage: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: {
      forceNewSession?: boolean;
      attachments?: MessageAttachmentInput[];
      contextPaths?: string[];
    }
  ) => Promise<boolean>;
  answerPermission: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse
  ) => Promise<boolean>;
  abortSession: () => Promise<void>;
  refreshMessages: () => Promise<void>;

  // Permissions (pending) visible for the active session, from the event-bus
  // store: the active session plus its known child sessions.
  permissions: WorkspacePermission[];

  // Diffs
  diffs: import("@/hooks/use-workspace-diffs").WorkspaceDiff[];
  isLoadingDiffs: boolean;
  diffsError: string | null;
  refreshDiffs: () => Promise<void>;

  // Models
  models: AvailableModel[];
  agentDefaultModel: AvailableModel | null;
  selectedModel: AvailableModel | null;
  hasManualModelSelection: boolean;
  setSelectedModel: (model: AvailableModel | null) => void;

  // Agents
  agentCatalog: AgentCatalogItem[];
};
