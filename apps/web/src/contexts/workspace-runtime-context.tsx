"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export function WorkspaceRuntimeProvider({
  children,
  initialSessionId = null,
  persistenceScope,
  reaperEnabled = true,
  slug,
}: WorkspaceRuntimeProviderProps) {
  const { instanceStatus, instanceError } = useInstanceStartup(slug);
  const running = instanceStatus === "running";

  const { connection, isConnected } = useWorkspaceConnection(slug, running);
  useInstanceHeartbeat(slug, running && reaperEnabled);

  // Next.js never passes searchParams to layouts, so the deep-linked
  // ?session= is read here on the client. The sessions hook captures it once
  // at mount; later param changes go through selectSession state instead.
  const searchParams = useSearchParams();
  const urlSessionId = searchParams?.get("session") ?? null;

  const sessionsHook = useWorkspaceSessions({
    slug,
    storageScope: persistenceScope,
    initialSessionId: initialSessionId ?? urlSessionId,
    isConnected: running && isConnected,
  });

  // Curator dialog + sidebar badge state lives here so the chrome (sidebar)
  // and the page shells (dialog) share one source of truth.
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [knowledgePendingCount, setKnowledgePendingCount] = useState(0);

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
      persistenceScope,
      refreshKnowledgePendingCount,
      sessionsHook,
      setCuratorOpen,
      setKnowledgePendingCount,
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
