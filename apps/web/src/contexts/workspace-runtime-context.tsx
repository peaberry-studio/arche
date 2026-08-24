"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSearchParams } from "next/navigation";

import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { useInstanceStartup, type UseInstanceStartupReturn } from "@/hooks/use-instance-startup";
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import { useWorkspaceSessions } from "@/hooks/workspace/use-workspace-sessions";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";
import {
  parseWorkspaceLayoutState,
  persistWorkspacePanelState,
  readWorkspacePanelState,
} from "@/lib/workspace-panel-state";

type WorkspaceRuntimeContextValue = Omit<UseInstanceStartupReturn, "instanceStatus"> & {
  instanceStatus: "starting" | "running" | "error" | null;
  connection: WorkspaceConnectionState;
  isConnected: boolean;
  sessionsHook: ReturnType<typeof useWorkspaceSessions>;
  slug: string;
  persistenceScope: string;
  curatorOpen: boolean;
  setCuratorOpen: (open: boolean) => void;
  knowledgePendingCount: number;
  setKnowledgePendingCount: (count: number) => void;
  refreshKnowledgePendingCount: () => Promise<void>;
  knowledgePublishCount: number;
  setKnowledgePublishCount: (count: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
};

type WorkspaceRuntimeProviderProps = {
  children: ReactNode;
  initialSessionId?: string | null;
  persistenceScope: string;
  reaperEnabled?: boolean;
  slug: string;
};

const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeContextValue | null>(null);

function countActionableKnowledgeProposals(value: unknown): number {
  if (!value || typeof value !== "object" || !("proposals" in value) || !Array.isArray(value.proposals)) {
    return 0;
  }

  return value.proposals.filter((proposal) => (
    proposal &&
    typeof proposal === "object" &&
    "status" in proposal &&
    (proposal.status === "open" || proposal.status === "needs_rebase")
  )).length;
}

type WorkspaceRuntimeStateProviderProps = {
  children: ReactNode;
  connection: WorkspaceConnectionState;
  initialSessionId: string | null;
  instanceError: string | null;
  instanceStatus: "starting" | "running" | "error" | null;
  isConnected: boolean;
  persistenceScope: string;
  slug: string;
};

export function WorkspaceRuntimeProvider({
  children,
  initialSessionId = null,
  persistenceScope,
  reaperEnabled = true,
  slug,
}: WorkspaceRuntimeProviderProps) {
  // Instance startup must stay in a component that does not read search
  // params. `useSearchParams()` + `router.replace(?session=)` can remount
  // the caller or abort the in-flight `ensureInstanceRunningAction`, which
  // leaves the workspace stuck on "Starting workspace".
  const { instanceStatus, instanceError } = useInstanceStartup(slug);
  const running = instanceStatus === "running";

  const { connection, isConnected } = useWorkspaceConnection(slug, running);
  useInstanceHeartbeat(slug, running && reaperEnabled);

  return (
    <WorkspaceRuntimeStateProvider
      connection={connection}
      initialSessionId={initialSessionId}
      instanceError={instanceError}
      instanceStatus={instanceStatus}
      isConnected={isConnected}
      persistenceScope={persistenceScope}
      slug={slug}
    >
      {children}
    </WorkspaceRuntimeStateProvider>
  );
}

function WorkspaceRuntimeStateProvider({
  children,
  connection,
  initialSessionId,
  instanceError,
  instanceStatus,
  isConnected,
  persistenceScope,
  slug,
}: WorkspaceRuntimeStateProviderProps) {
  const running = instanceStatus === "running";

  // Next.js never passes searchParams to layouts, so the deep-linked
  // ?session= is read here on the client. The sessions hook captures it once
  // at mount; the effect below keeps later param changes (back/forward,
  // shared links) in sync.
  const searchParams = useSearchParams();
  const urlSessionId = searchParams?.get("session") ?? null;

  const sessionsHook = useWorkspaceSessions({
    slug,
    initialSessionId: initialSessionId ?? urlSessionId,
    isConnected: running && isConnected,
  });

  // The sidebar chrome renders sessions on every workspace route, so the
  // provider owns the initial session load. Without this, a reload landing
  // directly on a non-chat route (e.g. explore) never mounts the chat hook
  // and the sessions rail stays empty. The chat route's own initial refresh
  // dedupes into the same in-flight load promise.
  const loadSessions = sessionsHook.loadSessions;
  useEffect(() => {
    if (!running || !isConnected) return;
    void loadSessions();
  }, [running, isConnected, loadSessions]);

  // The ?session= param is the source of truth for the active conversation.
  // The initial mount is handled by the sessions hook (which validates the
  // session against the loaded list); every later param change selects the
  // session so shared links and history navigation restore conversations.
  const didApplyUrlSessionRef = useRef(false);
  const selectSession = sessionsHook.selectSession;
  useEffect(() => {
    if (!didApplyUrlSessionRef.current) {
      didApplyUrlSessionRef.current = true;
      return;
    }
    if (urlSessionId) {
      selectSession(urlSessionId);
    }
  }, [urlSessionId, selectSession]);

  // Curator dialog + sidebar badge state lives here so the chrome (sidebar)
  // and the page shells (dialog) share one source of truth.
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [knowledgePendingCount, setKnowledgePendingCount] = useState(0);
  // Manual edits count is pushed by the shells (from their diffs), since
  // only they know when the workspace file list has changed.
  const [knowledgePublishCount, setKnowledgePublishCount] = useState(0);

  const refreshKnowledgePendingCount = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/learning`, { cache: "no-store" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) return;
      setKnowledgePendingCount(countActionableKnowledgeProposals(data));
    } catch {
      // Keep the last known count when learning data is temporarily unavailable.
    }
  }, [slug]);

  // Sidebar collapse is shared (chrome renders the sidebar, shells toggle it
  // via keyboard / command palette) and persisted per workspace scope.
  const sidebarStorageKey = `arche.workspace.${persistenceScope}.sidebar`;
  const sidebarCookieName = `arche-workspace-sidebar-${persistenceScope}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () =>
      readWorkspacePanelState(sidebarStorageKey, sidebarCookieName, parseWorkspaceLayoutState)
        ?.leftCollapsed === true
  );

  useEffect(() => {
    persistWorkspacePanelState(sidebarStorageKey, sidebarCookieName, { leftCollapsed: sidebarCollapsed });
  }, [sidebarCollapsed, sidebarCookieName, sidebarStorageKey]);

  const value = useMemo<WorkspaceRuntimeContextValue>(
    () => ({
      connection,
      curatorOpen,
      instanceError,
      instanceStatus,
      isConnected,
      knowledgePendingCount,
      knowledgePublishCount,
      persistenceScope,
      refreshKnowledgePendingCount,
      sessionsHook,
      setCuratorOpen,
      setKnowledgePendingCount,
      setKnowledgePublishCount,
      setSidebarCollapsed,
      sidebarCollapsed,
      slug,
    }),
    [
      connection,
      curatorOpen,
      instanceError,
      instanceStatus,
      isConnected,
      knowledgePendingCount,
      knowledgePublishCount,
      persistenceScope,
      refreshKnowledgePendingCount,
      sessionsHook,
      sidebarCollapsed,
      slug,
    ]
  );

  return (
    <WorkspaceRuntimeContext.Provider value={value}>{children}</WorkspaceRuntimeContext.Provider>
  );
}

export function useWorkspaceRuntime(): WorkspaceRuntimeContextValue {
  const context = useContext(WorkspaceRuntimeContext);
  if (!context) {
    throw new Error("useWorkspaceRuntime must be used within a WorkspaceRuntimeProvider");
  }
  return context;
}
