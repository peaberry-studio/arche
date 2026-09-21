"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useWorkspaceRuntime } from "@/contexts/workspace-runtime-context";
import { useWorkspace } from "@/hooks/use-workspace";
import { useConfigStatus } from "@/hooks/use-config-status";
import { useSkillsCatalog } from "@/hooks/use-skills-catalog";
import { useViewportWidth } from "@/hooks/use-viewport-width";
import type { WorkspaceSession } from "@/lib/opencode/types";
import {
  getWorkspaceFlowsHref,
  getWorkspaceHref,
  WORKSPACE_FLOWS_VIEWS,
} from "@/lib/workspace-hrefs";
import {
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";
import { isBusyFlowWorkspaceSession } from "@/lib/workspace-session-utils";
import {
  getWorkspaceLayoutCookieName,
  getWorkspaceLayoutStorageKey,
  persistWorkspacePanelState,
  parseWorkspaceLayoutState,
  readWorkspacePanelState,
  type StoredLayoutState,
} from "@/lib/workspace-panel-state";
import { cn } from "@/lib/utils";
import { flattenWorkspaceFileNodes, resolveWorkspaceFilePath } from "@/lib/workspace-file-search";

import { ChatPanel } from "./chat-panel";
import { ConfigChangeBanner } from "./config-change-banner";
import { CuratorDialog } from "./curator-dialog";
import { FilePreviewPanel } from "./file-preview-panel";
import { WorkspaceCatalogView } from "./workspace-catalog-view";
import { WorkspaceCommandPalette } from "./workspace-command-palette";
import { WorkspaceFlowsView } from "./workspace-flows-view";
import { COLLAPSED_PANEL_PX, MIN_CENTER_PX, MIN_LEFT_PX, MIN_RIGHT_PX, WORKSPACE_COMPACT_PANE_BREAKPOINT } from "./workspace-panes";
import { WorkspaceConnectingBanner } from "./workspace-startup-screens";

type WorkspaceShellProps = {
  slug: string;
  persistenceScope?: string;
  currentVault?: {
    id: string;
    name: string;
    path: string;
  } | null;
  initialLayoutState?: StoredLayoutState | null;
  isAdmin?: boolean;
  macDesktopWindowInset?: boolean;
  workspaceAgentEnabled?: boolean;
  slackIntegrationAvailable?: boolean;
  teamVisibilityAvailable?: boolean;
  recentUpdates?: { fileName: string; filePath: string }[];
};

const DEFAULT_LEFT_RATIO = 0.15;
const DEFAULT_RIGHT_RATIO = 0.3;
const PANEL_GAP = 0; // Gap between floating panels in pixels
const MOBILE_LAYOUT_BREAKPOINT = WORKSPACE_COMPACT_PANE_BREAKPOINT;
type MobileWorkspaceView = "chat" | "right";
const EMPTY_OPEN_FILE_PATHS: string[] = [];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getMinCenter = (containerWidth: number) =>
  Math.min(MIN_CENTER_PX, Math.max(0, containerWidth - MIN_LEFT_PX - MIN_RIGHT_PX - 2 * PANEL_GAP));

const fitWidths = (containerWidth: number, leftWidth: number, rightWidth: number) => {
  // Account for gaps in calculations
  const availableForPanels = containerWidth - 2 * PANEL_GAP;
  const minCenter = getMinCenter(containerWidth);
  const maxLeft = Math.max(MIN_LEFT_PX, availableForPanels - MIN_RIGHT_PX - minCenter);
  const maxRight = Math.max(MIN_RIGHT_PX, availableForPanels - MIN_LEFT_PX - minCenter);

  let nextLeft = clamp(leftWidth, MIN_LEFT_PX, maxLeft);
  let nextRight = clamp(rightWidth, MIN_RIGHT_PX, maxRight);

  const total = nextLeft + nextRight + minCenter + 2 * PANEL_GAP;
  if (total > containerWidth) {
    const overflow = total - containerWidth;
    const reducibleRight = Math.max(0, nextRight - MIN_RIGHT_PX);
    const reduceRight = Math.min(overflow, reducibleRight);
    nextRight -= reduceRight;
    const remaining = overflow - reduceRight;
    if (remaining > 0) {
      nextLeft = Math.max(MIN_LEFT_PX, nextLeft - remaining);
    }
  }

  return { left: nextLeft, right: nextRight, minCenter };
};

const getDefaultExpandedRightWidth = (
  containerWidth: number,
  leftWidth: number,
  leftCollapsed: boolean
) => {
  const effectiveLeft = leftCollapsed ? COLLAPSED_PANEL_PX : leftWidth;
  const availableForCenterAndRight = containerWidth - effectiveLeft - 2 * PANEL_GAP;
  return Math.max(availableForCenterAndRight / 2, MIN_RIGHT_PX);
};

const getContainerWidth = (container: HTMLDivElement | null) => {
  if (container) {
    return container.getBoundingClientRect().width;
  }
  if (typeof window !== "undefined") {
    return window.innerWidth;
  }
  return MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX;
};

const loadStoredLayout = (storageKey: string, cookieName: string): StoredLayoutState | null =>
  readWorkspacePanelState(storageKey, cookieName, parseWorkspaceLayoutState);

const persistLayout = (storageKey: string, cookieName: string, state: StoredLayoutState) => {
  persistWorkspacePanelState(storageKey, cookieName, state);
};

function resolveRootSessionId(
  sessionId: string | null,
  sessionsById: Map<string, WorkspaceSession>
): string | null {
  if (!sessionId) return null;

  let cursorId: string | null = sessionId;
  const visited = new Set<string>();

  while (cursorId) {
    if (visited.has(cursorId)) return cursorId;
    visited.add(cursorId);

    const current = sessionsById.get(cursorId);
    if (!current) return cursorId;
    if (!current.parentId || !sessionsById.has(current.parentId)) {
      return current.id;
    }
    cursorId = current.parentId;
  }

  return sessionId;
}

function getSessionDepth(
  session: WorkspaceSession,
  sessionsById: Map<string, WorkspaceSession>
): number {
  let depth = 0;
  let cursor = session;
  const visited = new Set<string>([session.id]);

  while (cursor.parentId) {
    const parent = sessionsById.get(cursor.parentId);
    if (!parent || visited.has(parent.id)) break;
    depth += 1;
    visited.add(parent.id);
    cursor = parent;
  }

  return depth;
}

export function WorkspaceShell({
  slug,
  persistenceScope,
  currentVault = null,
  initialLayoutState = null,
  isAdmin = false,
  macDesktopWindowInset = false,
  workspaceAgentEnabled = true,
  slackIntegrationAvailable = false,
  teamVisibilityAvailable = false,
  recentUpdates = [],
}: WorkspaceShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const catalogParam = searchParams.get("catalog");
  const flowsParam = searchParams.get("flows");

  const containerRef = useRef<HTMLDivElement>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const resolvedPersistenceScope = persistenceScope ?? slug;
  const layoutCookieName = getWorkspaceLayoutCookieName(resolvedPersistenceScope);
  const layoutStorageKey = getWorkspaceLayoutStorageKey(resolvedPersistenceScope);

  // Instance startup state comes from the layout-level runtime provider so
  // chat ↔ explore navigation does not re-run the startup waterfall.
  const {
    connection,
    curatorOpen,
    instanceStatus,
    instanceError,
    isConnected,
    refreshKnowledgePendingCount,
    setCuratorOpen,
    setKnowledgePendingCount,
    setKnowledgePublishCount,
    setSidebarCollapsed,
  } = useWorkspaceRuntime();

  // Config change detection
  const configStatus = useConfigStatus(slug, instanceStatus === "running");

  // Use workspace hook only when instance is running
  const workspace = useWorkspace({
    slug,
    pollInterval: 20000,
    enabled: instanceStatus === 'running',
    workspaceAgentEnabled,
  });
  const skillsCatalog = useSkillsCatalog(slug)
  const {
    readFile: readWorkspaceFile,
  } = workspace;
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    content: string;
    hash?: string;
  } | null>(null);
  const [learningRefreshKey, setLearningRefreshKey] = useState(0);
  const refreshKnowledgeWorkspace = useCallback(() => {
    workspace.refreshDiffs();
    workspace.refreshFiles();
  }, [workspace]);
  // Only for callers that can run while the review list is unmounted (connect,
  // publish, starting a learning run). When the list is on screen it reports the
  // count itself, so refetching here would just duplicate its request.
  const refreshKnowledgeReview = useCallback(() => {
    refreshKnowledgeWorkspace();
    void refreshKnowledgePendingCount();
  }, [refreshKnowledgePendingCount, refreshKnowledgeWorkspace]);

  // Manual edits count feeds the sidebar badge, so it must track every
  // diffs refresh (apply, publish, discard, conflict resolution).
  useEffect(() => {
    setKnowledgePublishCount(workspace.diffs.length);
  }, [setKnowledgePublishCount, workspace.diffs]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, WorkspaceSession>();
    workspace.sessions.forEach((session) => {
      map.set(session.id, session);
    });
    return map;
  }, [workspace.sessions]);

  // Keep the ?session= param in sync with the active conversation so the chat
  // URL is restorable and shareable. Management overlays (catalog, flows) own
  // their navigation, so their params are left untouched.
  //
  // Do not rewrite the URL until the session list is validated. Replacing
  // `?session=` during startup aborts the in-flight ensureInstanceRunningAction
  // and leaves the workspace on "Starting workspace".
  useEffect(() => {
    if (catalogParam || flowsParam) return;
    if (!workspace.isInitialSessionsReady) return;

    const urlSessionId = searchParams.get("session");
    if (workspace.activeSessionId === urlSessionId) return;

    const params = new URLSearchParams(searchParams.toString());
    if (workspace.activeSessionId) {
      params.set("session", workspace.activeSessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    router.replace(query ? `/w/${slug}?${query}` : `/w/${slug}`);
  }, [catalogParam, flowsParam, router, searchParams, slug, workspace.activeSessionId, workspace.isInitialSessionsReady]);

  const activeRootSessionId = useMemo(
    () => resolveRootSessionId(workspace.activeSessionId, sessionsById),
    [workspace.activeSessionId, sessionsById]
  );

  const activeSessionTabs = useMemo(() => {
    if (!activeRootSessionId) return [];

    const belongsToRoot = (session: WorkspaceSession) => {
      let cursor: WorkspaceSession | undefined = session;
      const visited = new Set<string>();

      while (cursor) {
        if (cursor.id === activeRootSessionId) return true;
        if (!cursor.parentId || visited.has(cursor.id)) return false;
        visited.add(cursor.id);
        cursor = sessionsById.get(cursor.parentId);
      }

      return false;
    };

    const root = sessionsById.get(activeRootSessionId);
    const descendants = workspace.sessions
      .filter((session) => session.id !== activeRootSessionId && belongsToRoot(session))
      .sort((a, b) => (b.updatedAtRaw ?? 0) - (a.updatedAtRaw ?? 0));

    const ordered = root ? [root, ...descendants] : descendants;

    return ordered.map((session) => ({
      id: session.id,
      title: session.title,
      depth: getSessionDepth(session, sessionsById),
      status: session.status,
    }));
  }, [activeRootSessionId, sessionsById, workspace.sessions]);

  const isInspectingSubagentSession = useMemo(() => {
    if (!workspace.activeSessionId) return false;

    const activeSession = sessionsById.get(workspace.activeSessionId);
    if (!activeSession) return false;

    return getSessionDepth(activeSession, sessionsById) > 0;
  }, [sessionsById, workspace.activeSessionId]);

  // Auto-sync KB on first connection
  const hasAutoSynced = useRef(false);

  useEffect(() => {
    if (!workspace.isConnected || hasAutoSynced.current) return;
    hasAutoSynced.current = true;

    (async () => {
      try {
        await fetch(`/api/instances/${slug}/sync-kb`, { method: 'POST' });
      } catch {
        // silent — auto-sync is best-effort
      }
      refreshKnowledgeReview();
    })();
  }, [refreshKnowledgeReview, slug, workspace.isConnected]);

  // Layout state (global, not per-mode)
  const [leftCollapsed, setLeftCollapsedState] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsedState] = useState<boolean>(false);
  const [leftWidth, setLeftWidth] = useState<number>(MIN_LEFT_PX);
  const [rightWidth, setRightWidth] = useState<number>(MIN_RIGHT_PX);
  const setLeftCollapsed = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setLeftCollapsedState((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);
  const setRightCollapsed = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setRightCollapsedState((prev) => (typeof value === "function" ? value(prev) : value));
  }, []);
  const [hydratedLayoutKey, setHydratedLayoutKey] = useState<string | null>(null);
  const viewportWidth = useViewportWidth();
  const [mobileView, setMobileView] = useState<MobileWorkspaceView>("chat");
  const isCompactLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const wasCompactLayoutRef = useRef(isCompactLayout);

  useEffect(() => {
    if (!wasCompactLayoutRef.current && isCompactLayout) {
      setMobileView("chat");
    }

    wasCompactLayoutRef.current = isCompactLayout;
  }, [isCompactLayout]);

  const handleToggleLeft = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, [setSidebarCollapsed]);

  const toggleRightPanel = useCallback(() => {
    if (isCompactLayout) {
      setMobileView((prev) => (prev === "right" ? "chat" : "right"));
      return;
    }

    setRightCollapsed((previous) => {
      if (!previous) {
        return true;
      }

      const containerWidth = getContainerWidth(containerRef.current);
      const nextRightWidth = getDefaultExpandedRightWidth(containerWidth, leftWidth, leftCollapsed);

      if (leftCollapsed) {
        const minCenter = getMinCenter(containerWidth);
        const maxRight = Math.max(
          MIN_RIGHT_PX,
          containerWidth - COLLAPSED_PANEL_PX - minCenter - 2 * PANEL_GAP
        );

        setRightWidth(clamp(nextRightWidth, MIN_RIGHT_PX, maxRight));

        return false;
      }

      const fitted = fitWidths(containerWidth, leftWidth, nextRightWidth);
      setLeftWidth(fitted.left);
      setRightWidth(fitted.right);

      return false;
    });
  }, [isCompactLayout, leftCollapsed, leftWidth, setRightCollapsed]);

  const switchToChatOnMobile = useCallback(() => {
    if (isCompactLayout) setMobileView("chat");
  }, [isCompactLayout]);

  const navigateSettings = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'general' }));
  }, [router, slug]);

  const navigateConnectors = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'connectors' }));
  }, [router, slug]);

  const navigateProviders = useCallback(() => {
    router.push(getWorkspaceHref(slug, { settings: 'providers' }));
  }, [router, slug]);

  const handleOpenFlowsManager = useCallback(() => {
    router.push(getWorkspaceFlowsHref(slug, 'list'));
  }, [router, slug]);

  const flattenedFilePaths = useMemo(() => {
    return flattenWorkspaceFileNodes(workspace.fileTree).map((file) => file.path);
  }, [workspace.fileTree]);

  const markdownFilePaths = useMemo(
    () => flattenedFilePaths.filter((path) => path.toLowerCase().endsWith(".md")),
    [flattenedFilePaths]
  );

  const handleOpenFileInExplore = useCallback(
    (path: string) => {
      const resolvedPath = resolveWorkspaceFilePath(path, flattenedFilePaths);
      if (!resolvedPath) return;
      // Opening a file navigates to Explore; the target screen shows the file
      // itself, so the Curator dialog must not stay open over it.
      setCuratorOpen(false);
      router.push(`/w/${slug}/explore?path=${encodeURIComponent(resolvedPath)}`);
    },
    [flattenedFilePaths, router, setCuratorOpen, slug]
  );

  const handleCommandPaletteOpenFile = useCallback(
    (path: string) => handleOpenFileInExplore(path),
    [handleOpenFileInExplore]
  );

  const handleOpenExplore = useCallback(() => {
    router.push(`/w/${slug}/explore`);
  }, [router, slug]);

  const handleCreateSession = useCallback(() => {
    switchToChatOnMobile();
    workspace.selectSession(null);
    router.push(getWorkspaceHref(slug));
  }, [router, slug, switchToChatOnMobile, workspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;

      const key = event.key.toLowerCase();
      const isMetaCombo = event.metaKey || event.ctrlKey;
      const isPlainMetaCombo = isMetaCombo && !event.altKey;
      const isKeyB = key === "b" || event.code === "KeyB";

      if (isKeyB) {
        event.preventDefault();
        if (event.altKey) {
          toggleRightPanel();
          return;
        }

        setSidebarCollapsed((prev) => !prev);
        return;
      }

      if (!isPlainMetaCombo) return;

      if (key === ".") {
        event.preventDefault();
        void handleCreateSession();
        return;
      }

      if (key !== "k") return;

      event.preventDefault();
      setCommandPaletteOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCreateSession, setSidebarCollapsed, toggleRightPanel]);

  const handlePublishComplete = useCallback(() => {
    refreshKnowledgeReview();
  }, [refreshKnowledgeReview]);

  const handleDiscardFileChanges = useCallback(
    async (path: string) => {
      const result = await workspace.discardFileChanges(path);
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "discard_failed" };
      }
      refreshKnowledgeReview();
      return { ok: true as const };
    },
    [refreshKnowledgeReview, workspace]
  );

  const handleResolveConflict = useCallback(
    async (_path: string) => {
      refreshKnowledgeReview();
    },
    [refreshKnowledgeReview]
  );

  // File handlers
  const handleOpenFile = useCallback(
    async (path: string) => {
      const resolvedPath = resolveWorkspaceFilePath(path, flattenedFilePaths);
      const pathToOpen = resolvedPath || path;
      const normalizedPath = normalizeWorkspacePath(pathToOpen);

      if (!normalizedPath || isProtectedWorkspacePath(normalizedPath)) {
        return;
      }

      setPreviewFilePath(normalizedPath);
      setRightCollapsed(false);
      if (isCompactLayout) {
        setMobileView("right");
      }

      if (previewFile?.path !== normalizedPath) {
        setPreviewFile(null);
        const result = await readWorkspaceFile(normalizedPath);
        setPreviewFile({
          path: normalizedPath,
          content: result?.content ?? "Unable to load file.",
          hash: result?.hash,
        });
      }
    },
    [
      isCompactLayout,
      previewFile,
      readWorkspaceFile,
      flattenedFilePaths,
      setRightCollapsed,
    ]
  );

  const handleEditFromPreview = useCallback(() => {
    if (!previewFilePath) return;
    const path = previewFilePath;
    setPreviewFilePath(null);
    router.push(`/w/${slug}/explore?path=${encodeURIComponent(path)}`);
  }, [previewFilePath, router, slug]);

  function handleClosePreview() {
    setPreviewFilePath(null);
    setPreviewFile(null);
    if (isCompactLayout) {
      setMobileView("chat");
    }
  }

  // Session handlers
  const handleCommandPaletteSelectSession = useCallback(
    (sessionId: string) => {
      switchToChatOnMobile();
      workspace.selectSession(sessionId);
    },
    [switchToChatOnMobile, workspace]
  );

  const openCurator = useCallback(() => {
    setCuratorOpen(true);
    void refreshKnowledgePendingCount();
  }, [refreshKnowledgePendingCount, setCuratorOpen]);

  const handleSelectSessionTab = useCallback((sessionId: string) => {
    workspace.selectSession(sessionId);
  }, [workspace]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    await workspace.deleteSession(sessionId);
  }, [workspace]);

  const handleRenameSession = useCallback(
    async (sessionId: string, title: string) => {
      return workspace.renameSession(sessionId, title);
    },
    [workspace]
  );

  const handleLearnSession = useCallback(
    async (session: { id: string; title: string }) => {
      try {
        const response = await fetch(`/api/u/${slug}/learning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceSessionId: session.id, title: session.title }),
        });
        if (response.ok) {
          void refreshKnowledgePendingCount();
          toast.success("Learning started", {
            action: {
              label: "Open Curator",
              onClick: openCurator,
            },
          });
        } else {
          toast.error("Could not start learning")
        }
      } catch {
        toast.error("Could not start learning")
      }
      setLearningRefreshKey((current) => current + 1);
    },
    [openCurator, refreshKnowledgePendingCount, slug]
  );

  const handleLearningProposalSentToReview = useCallback(() => {
    refreshKnowledgeWorkspace();
  }, [refreshKnowledgeWorkspace]);

  const handleFlowHumanResponseSubmitted = useCallback(async () => {
    await Promise.all([
      workspace.refreshMessages(),
      workspace.refreshSessions(),
    ]);
  }, [workspace]);

  // Load layout from localStorage (global values, ignoring legacy per-mode maps)
  useEffect(() => {
    const stored = loadStoredLayout(layoutStorageKey, layoutCookieName) ?? initialLayoutState;
    const containerWidth = getContainerWidth(containerRef.current);
    const defaultLeft = stored?.leftWidth ?? containerWidth * DEFAULT_LEFT_RATIO;
    const defaultRight = stored?.rightWidth ?? containerWidth * DEFAULT_RIGHT_RATIO;

    const fitted = fitWidths(containerWidth, defaultLeft, defaultRight);
    setLeftWidth(fitted.left);
    setRightWidth(fitted.right);

    if (typeof stored?.leftCollapsed === "boolean") {
      setLeftCollapsed(stored.leftCollapsed);
    }
    if (typeof stored?.rightCollapsed === "boolean") {
      setRightCollapsed(stored.rightCollapsed);
    }

    setHydratedLayoutKey(layoutStorageKey);
  }, [initialLayoutState, layoutCookieName, layoutStorageKey, setLeftCollapsed, setRightCollapsed]);

  // Persist layout
  useEffect(() => {
    if (hydratedLayoutKey !== layoutStorageKey) return;
    persistLayout(layoutStorageKey, layoutCookieName, {
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed,
    });
  }, [
    hydratedLayoutKey,
    layoutCookieName,
    layoutStorageKey,
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    rightWidth,
  ]);

  // Map workspace sessions to UI format
  const uiSessions = useMemo(() => {
    return workspace.sessions.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status === 'busy' ? 'active' as const : s.status === 'idle' ? 'idle' as const : 'archived' as const,
      updatedAt: s.updatedAt,
      agent: 'OpenCode',
      flow: s.flow,
    }));
  }, [workspace.sessions]);

  // Map workspace messages to UI format
  const uiMessages = useMemo(() => {
      return workspace.messages.map(m => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      timestamp: m.timestamp,
      timestampRaw: m.timestampRaw,
      parts: m.parts, // Pass all parts for rich rendering
      statusInfo: m.statusInfo,
        pending: m.pending,
        attachments: m.parts
          .filter(p => p.type === 'file')
          .map(p => ({
            type: 'file' as const,
            label:
              (p as { filename?: string }).filename ??
              (p as { path: string }).path?.split('/').pop() ??
              '',
            path: (p as { path: string }).path
          }))
    }));
  }, [workspace.messages]);

  // The chrome (sidebar) always renders. While the instance is starting or the
  // connection is not yet established, the center shows an in-pane banner
  // instead of the chat panel. This keeps the sidebar mounted across
  // chat ↔ explorer navigation.
  const isReady = instanceStatus === 'running' && isConnected;

  const activeSessionRecord = workspace.activeSessionId
    ? sessionsById.get(workspace.activeSessionId) ?? null
    : null;
  const isBusyFlowSession = isBusyFlowWorkspaceSession(activeSessionRecord);
  const isReadOnlyChatSession = isInspectingSubagentSession || isBusyFlowSession;

  const chatPanelElement = (
    <ChatPanel
      key={workspace.activeSessionId ?? "no-session"}
      slug={slug}
      agents={workspace.agentCatalog}
      recentUpdates={recentUpdates}
      attachmentsEnabled={workspaceAgentEnabled}
      contextFilePaths={markdownFilePaths}
      sessions={uiSessions}
      skills={skillsCatalog.skills}
      messages={uiMessages}
      permissions={workspace.permissions}
      permissionToolParts={workspace.permissionToolParts}
      activeSessionId={workspace.activeSessionId}
      isInitialSessionsReady={workspace.isInitialSessionsReady}
      isLoadingMessages={workspace.isLoadingMessages}
      sessionsError={workspace.sessionsError}
      isStartingNewSession={workspace.isStartingNewSession}
      sessionTabs={activeSessionTabs}
      openFilePaths={EMPTY_OPEN_FILE_PATHS}
      onCloseSession={handleCloseSession}
      onLearnSession={handleLearnSession}
      onRenameSession={handleRenameSession}
      onSelectSessionTab={handleSelectSessionTab}
      onOpenFile={handleOpenFile}
      onSendMessage={workspace.sendMessage}
      onAnswerPermission={workspace.answerPermission}
      onAbortMessage={workspace.abortSession}
      isSending={workspace.isSending}
      models={workspace.models}
      agentDefaultModel={workspace.agentDefaultModel}
      selectedModel={workspace.selectedModel}
      hasManualModelSelection={workspace.hasManualModelSelection}
      onSelectModel={workspace.setSelectedModel}
      isReadOnly={isReadOnlyChatSession}
      flowHumanResponseRunId={
        activeSessionRecord?.flow?.status === "waiting_for_human"
          ? activeSessionRecord.flow.runId
          : null
      }
      onFlowHumanResponseSubmitted={handleFlowHumanResponseSubmitted}
      readOnlyNotice={
        isBusyFlowSession
          ? "This flow run is still in progress. It is read-only until Flows finishes."
          : undefined
      }
      onReturnToMainConversation={
        isInspectingSubagentSession && activeRootSessionId
          ? () => workspace.selectSession(activeRootSessionId)
          : undefined
      }
      workspaceRoot={currentVault ? `${currentVault.path}/workspace` : undefined}
    />
  );

  const catalogActive = catalogParam === "agents" || catalogParam === "skills";
  const flowsActive = flowsParam
    ? (WORKSPACE_FLOWS_VIEWS as readonly string[]).includes(flowsParam)
    : false;
  const centerPanelElement = catalogActive ? (
    <WorkspaceCatalogView slug={slug} isAdmin={isAdmin} />
  ) : flowsActive ? (
    <WorkspaceFlowsView
      slug={slug}
      slackIntegrationAvailable={slackIntegrationAvailable}
      teamVisibilityAvailable={teamVisibilityAvailable}
    />
  ) : isReady ? chatPanelElement : (
    <WorkspaceConnectingBanner
      connection={connection}
      instanceError={instanceError}
      instanceStatus={instanceStatus}
    />
  );
  const previewCacheEntry = previewFilePath && previewFile?.path === previewFilePath
    ? previewFile
    : null;
  const previewPanelElement = previewFilePath ? (
    <FilePreviewPanel
      path={previewFilePath}
      content={previewCacheEntry?.content ?? ''}
      isLoading={!previewCacheEntry}
      onClose={handleClosePreview}
      onEdit={handleEditFromPreview}
    />
  ) : null;

  const hasPreviewPanel = previewFilePath !== null;
  const hasRightPanel = hasPreviewPanel;
  const rightPanelContent = previewPanelElement;

  // The sidebar lives in WorkspaceAppChrome (layout level) so it stays mounted
  // across chat ↔ explore navigation. The shell renders only the chat main.
  const isChatActive = mobileView === "chat";
  const isRightPanelActive = mobileView === "right";

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && 'desktop-no-select',
      )}
    >
      <WorkspaceCommandPalette
        fileNodes={workspace.fileTree}
        slug={slug}
        open={commandPaletteOpen}
        hideFlows={false}
        onOpenChange={setCommandPaletteOpen}
        onCreateSession={handleCreateSession}
        onOpenCurator={openCurator}
        onOpenExplore={handleOpenExplore}
        onNavigateFlows={handleOpenFlowsManager}
        onOpenFile={handleCommandPaletteOpenFile}
        onNavigateConnectors={navigateConnectors}
        onNavigateProviders={navigateProviders}
        onNavigateSettings={navigateSettings}
        onRefreshSessions={workspace.refreshSessions}
        onSelectSession={handleCommandPaletteSelectSession}
        onToggleLeftPanel={handleToggleLeft}
      />
      <CuratorDialog
        open={curatorOpen}
        onOpenChange={setCuratorOpen}
        slug={slug}
        workspaceAgentEnabled={workspaceAgentEnabled}
        diffs={workspace.diffs}
        isLoadingDiffs={workspace.isLoadingDiffs}
        diffsError={workspace.diffsError}
        onOpenFile={handleOpenFileInExplore}
        internalLinkPaths={markdownFilePaths}
        onDiscardFileChanges={workspaceAgentEnabled ? handleDiscardFileChanges : undefined}
        onPublish={workspaceAgentEnabled ? handlePublishComplete : undefined}
        onResolveConflict={workspaceAgentEnabled ? handleResolveConflict : undefined}
        onKnowledgeReviewApplied={handleLearningProposalSentToReview}
        onProposalCountChange={setKnowledgePendingCount}
        knowledgeReviewRefreshKey={learningRefreshKey}
      />
      {!currentVault ? (
        <ConfigChangeBanner
          pending={configStatus.pending}
          reason={configStatus.reason}
          restarting={configStatus.restarting}
          restartError={configStatus.restartError}
          onRestart={configStatus.restart}
        />
      ) : null}
      <div className="flex min-h-0 flex-1">
        {isCompactLayout ? (
          <div className="relative min-h-0 flex-1">
            <div
              className="absolute inset-0 min-h-0 overflow-hidden"
              style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
              hidden={!isChatActive}
              aria-hidden={!isChatActive}
            >
              <div className="h-full min-h-0 overflow-hidden">
                {centerPanelElement}
              </div>
            </div>

            {hasRightPanel ? (
              <div
                className="absolute inset-0 min-h-0 overflow-hidden bg-background"
                style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
                hidden={!isRightPanelActive}
                aria-hidden={!isRightPanelActive}
              >
                {rightPanelContent}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full">
            <div className="flex min-w-0 flex-1 items-stretch justify-center">
              <div
                data-testid="panes-center"
                className={cn('h-full w-full min-w-0 overflow-hidden', hasRightPanel && 'border-r border-border/30')}
              >
                {centerPanelElement}
              </div>
            </div>

            {hasRightPanel ? (
              <div
                data-testid="panes-right"
                className="box-border shrink-0 overflow-hidden"
                style={{
                  width: rightCollapsed ? 0 : rightWidth,
                  minWidth: rightCollapsed ? 0 : MIN_RIGHT_PX,
                }}
              >
                {rightPanelContent}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
