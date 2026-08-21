"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatCircle, Compass, File } from "@phosphor-icons/react";

import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useInstanceStartup } from "@/hooks/use-instance-startup";
import { useWorkspace } from "@/hooks/use-workspace";
import { useConfigStatus } from "@/hooks/use-config-status";
import { useSkillsCatalog } from "@/hooks/use-skills-catalog";
import type { WorkspaceSession } from "@/lib/opencode/types";
import { getDesktopFlowsHref, getDesktopWorkspaceHref } from "@/lib/runtime/desktop/current-vault";
import {
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";
import {
  excludeSubagentSessions,
  isBusyFlowWorkspaceSession,
} from "@/lib/workspace-session-utils";
import {
  getWorkspaceLayoutCookieName,
  getWorkspaceLayoutStorageKey,
  persistWorkspacePanelState,
  parseWorkspaceLayoutState,
  readWorkspacePanelState,
  type StoredLayoutState,
} from "@/lib/workspace-panel-state";
import {
  takeWorkspaceStartPrompt,
  type WorkspaceStartPrompt,
} from "@/lib/workspace-start-prompt";
import { cn } from "@/lib/utils";
import { flattenWorkspaceFileNodes } from "@/lib/workspace-file-search";

import { ChatPanel } from "./chat-panel";
import { ConfigChangeBanner } from "./config-change-banner";
import { CuratorDialog } from "./curator-dialog";
import { FilePreviewPanel } from "./file-preview-panel";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { WorkspaceCommandPalette } from "./workspace-command-palette";
import { COLLAPSED_PANEL_PX, MIN_LEFT_PX, MIN_RIGHT_PX, WorkspacePanes } from "./workspace-panes";
import { WorkspaceSidebar } from "./workspace-sidebar";
import {
  WorkspaceConnectingScreen,
  WorkspaceStartupScreen,
} from "./workspace-startup-screens";

type WorkspaceShellProps = {
  slug: string;
  persistenceScope?: string;
  currentVault?: {
    id: string;
    name: string;
    path: string;
  } | null;
  initialSessionId?: string | null;
  initialLayoutState?: StoredLayoutState | null;
  macDesktopWindowInset?: boolean;
  workspaceAgentEnabled?: boolean;
  reaperEnabled?: boolean;
};

const MIN_CENTER_PX = 360;
const DEFAULT_LEFT_RATIO = 0.15;
const DEFAULT_RIGHT_RATIO = 0.3;
const PANEL_GAP = 0; // Gap between floating panels in pixels
const MOBILE_LAYOUT_BREAKPOINT =
  MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX + 2 * PANEL_GAP + 48;
type MobileWorkspaceView = "chat" | "left" | "right";
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

export function WorkspaceShell({
  slug,
  persistenceScope,
  currentVault = null,
  initialSessionId = null,
  initialLayoutState = null,
  macDesktopWindowInset = false,
  workspaceAgentEnabled = true,
  reaperEnabled = true,
}: WorkspaceShellProps) {
  const router = useRouter();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const resolvedPersistenceScope = persistenceScope ?? slug;
  const layoutCookieName = getWorkspaceLayoutCookieName(resolvedPersistenceScope);
  const layoutStorageKey = getWorkspaceLayoutStorageKey(resolvedPersistenceScope);
  const [curatorOpen, setCuratorOpen] = useState(false);

  // Instance startup state
  const { instanceStatus, instanceError } = useInstanceStartup(slug);
  const [rightTab, setRightTab] = useState<"preview" | "review">("preview");
  const effectiveRightTab = workspaceAgentEnabled ? rightTab : "preview";

  // Config change detection
  const configStatus = useConfigStatus(slug, instanceStatus === "running");

  // Use workspace hook only when instance is running
  const workspace = useWorkspace({
    slug,
    storageScope: resolvedPersistenceScope,
    initialSessionId,
    pollInterval: 20000,
    enabled: instanceStatus === 'running',
    workspaceAgentEnabled,
    reaperEnabled,
  });
  const skillsCatalog = useSkillsCatalog(slug)
  const {
    readFile: readWorkspaceFile,
  } = workspace;
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    content: string;
    hash?: string;
  } | null>(null);
  const previewOpenFrameRef = useRef<number | null>(null);
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [learningRefreshKey, setLearningRefreshKey] = useState(0);
  const [knowledgeProposalCount, setKnowledgeProposalCount] = useState(0);
  const refreshKnowledgePendingCount = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/learning`, { cache: "no-store" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) return;
      setKnowledgeProposalCount(countActionableKnowledgeProposals(data));
    } catch {
      // Keep the last known count when learning data is temporarily unavailable.
    }
  }, [slug]);
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

  const sessionsById = useMemo(() => {
    const map = new Map<string, WorkspaceSession>();
    workspace.sessions.forEach((session) => {
      map.set(session.id, session);
    });
    return map;
  }, [workspace.sessions]);

  const rootSessions = useMemo(
    () => excludeSubagentSessions(workspace.sessions),
    [workspace.sessions]
  );

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

  // Auto-start a new chat session if we have a pending prompt
  const hasAutoStartedPrompt = useRef(false);

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

  useEffect(() => {
    if (!workspace.isConnected || hasAutoStartedPrompt.current) return;

    let prompt: WorkspaceStartPrompt | null = null;
    try {
      prompt = takeWorkspaceStartPrompt(window.sessionStorage, resolvedPersistenceScope);
    } catch {
      prompt = null;
    }

    hasAutoStartedPrompt.current = true;
    if (!prompt) return;

    void workspace.sendMessage(prompt.text, undefined, {
      forceNewSession: true,
      contextPaths: prompt.contextPaths,
    });
  }, [resolvedPersistenceScope, workspace, workspace.isConnected]);

  // Layout state (global, not per-mode)
  const [minCenterWidth, setMinCenterWidth] = useState(MIN_CENTER_PX);
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
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX : window.innerWidth
  );
  const [mobileView, setMobileView] = useState<MobileWorkspaceView>("chat");
  const isCompactLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const wasCompactLayoutRef = useRef(isCompactLayout);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      const nextWidth = window.innerWidth;
      const nextCompactState = nextWidth < MOBILE_LAYOUT_BREAKPOINT;

      setViewportWidth(nextWidth);

      if (!wasCompactLayoutRef.current && nextCompactState) {
        setMobileView("chat");
      }

      wasCompactLayoutRef.current = nextCompactState;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const handleToggleLeft = useCallback(() => {
    if (isCompactLayout) {
      setMobileView((prev) => (prev === "left" ? "chat" : "left"));
      return;
    }

    setLeftCollapsed((prev) => !prev);
  }, [isCompactLayout, setLeftCollapsed]);

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
        setMinCenterWidth(minCenter);

        return false;
      }

      const fitted = fitWidths(containerWidth, leftWidth, nextRightWidth);
      setLeftWidth(fitted.left);
      setRightWidth(fitted.right);
      setMinCenterWidth(fitted.minCenter);

      return false;
    });
  }, [isCompactLayout, leftCollapsed, leftWidth, setRightCollapsed]);

  const handleToggleRight = useCallback(() => {
    toggleRightPanel();
  }, [toggleRightPanel]);

  const handleShowChat = useCallback(() => {
    setMobileView("chat");
  }, []);

  const switchToChatOnMobile = useCallback(() => {
    if (isCompactLayout) setMobileView("chat");
  }, [isCompactLayout]);

  const navigateSettings = useCallback(() => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'providers') : `/u/${slug}/settings`,
    );
  }, [currentVault, router, slug]);

  const navigateConnectors = useCallback(() => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'connectors') : `/u/${slug}/connectors`,
    );
  }, [currentVault, router, slug]);

  const navigateProviders = useCallback(() => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'providers') : `/u/${slug}/settings`,
    );
  }, [currentVault, router, slug]);

  const handleOpenFlowsManager = useCallback(() => {
    router.push(currentVault ? getDesktopFlowsHref(slug, 'list') : `/u/${slug}/flows`);
  }, [currentVault, router, slug]);

  const navigateAgents = useCallback(() => {
    router.push(`/u/${slug}/agents`);
  }, [router, slug]);

  const navigateSkills = useCallback(() => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'skills') : `/u/${slug}/skills`,
    );
  }, [currentVault, router, slug]);

  const flattenedFilePaths = useMemo(() => {
    return flattenWorkspaceFileNodes(workspace.fileTree).map((file) => file.path);
  }, [workspace.fileTree]);

  const filePathSet = useMemo(() => new Set(flattenedFilePaths), [flattenedFilePaths]);
  const markdownFilePaths = useMemo(
    () => flattenedFilePaths.filter((path) => path.toLowerCase().endsWith(".md")),
    [flattenedFilePaths]
  );

  const normalizePath = useCallback((path: string) => {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  }, []);

  const resolveFilePath = useCallback((path: string) => {
    if (!path) return path;
    const normalized = normalizePath(path);
    if (filePathSet.has(normalized)) return normalized;

    const trimmed = normalized.replace(/^\/+/, "");
    if (filePathSet.has(trimmed)) return trimmed;

    const matches = flattenedFilePaths.filter((candidate) =>
      normalized.endsWith(candidate) || trimmed.endsWith(candidate)
    );
    if (matches.length === 0) return normalized;

    matches.sort((a, b) => b.length - a.length);
    return matches[0];
  }, [filePathSet, flattenedFilePaths, normalizePath]);

  const handleOpenFileInExplore = useCallback(
    (path: string) => {
      const resolvedPath = resolveFilePath(path);
      if (!resolvedPath) return;
      router.push(`/w/${slug}/explore?path=${encodeURIComponent(resolvedPath)}`);
    },
    [resolveFilePath, router, slug]
  );

  const handleCommandPaletteOpenFile = useCallback(
    (path: string) => handleOpenFileInExplore(path),
    [handleOpenFileInExplore]
  );

  const handleOpenExplore = useCallback(() => {
    router.push(`/w/${slug}/explore`);
  }, [router, slug]);

  const handleCreateSession = useCallback(async () => {
    switchToChatOnMobile();
    await workspace.createSession();
  }, [switchToChatOnMobile, workspace]);

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

        if (isCompactLayout) {
          setMobileView((prev) => (prev === "left" ? "chat" : "left"));
        } else {
          setLeftCollapsed((prev) => !prev);
        }
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
  }, [handleCreateSession, isCompactLayout, setLeftCollapsed, toggleRightPanel]);

  const handleSyncComplete = useCallback((status: SyncKbResult["status"]) => {
    refreshKnowledgeReview();

    if (status === "synced") {
      void workspace.refreshFiles();
    }
  }, [refreshKnowledgeReview, workspace]);

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
      const resolvedPath = resolveFilePath(path);
      const pathToOpen = resolvedPath || path;
      const normalizedPath = normalizeWorkspacePath(pathToOpen);

      if (!normalizedPath || isProtectedWorkspacePath(normalizedPath)) {
        return;
      }

      if (previewCloseTimerRef.current) {
        clearTimeout(previewCloseTimerRef.current);
        previewCloseTimerRef.current = null;
      }
      if (previewOpenFrameRef.current !== null) {
        cancelAnimationFrame(previewOpenFrameRef.current);
      }
      setPreviewExpanded(false);
      setPreviewFilePath(normalizedPath);
      previewOpenFrameRef.current = requestAnimationFrame(() => {
        setPreviewExpanded(true);
        previewOpenFrameRef.current = null;
      });
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
      resolveFilePath,
      setRightCollapsed,
    ]
  );

  const handleEditFromPreview = useCallback(() => {
    if (!previewFilePath) return;
    const path = previewFilePath;
    if (previewOpenFrameRef.current !== null) {
      cancelAnimationFrame(previewOpenFrameRef.current);
      previewOpenFrameRef.current = null;
    }
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
    setPreviewExpanded(false);
    setPreviewFilePath(null);
    router.push(`/w/${slug}/explore?path=${encodeURIComponent(path)}`);
  }, [previewFilePath, router, slug]);

  function handleClosePreview() {
    setPreviewExpanded(false);
    if (previewOpenFrameRef.current !== null) {
      cancelAnimationFrame(previewOpenFrameRef.current);
      previewOpenFrameRef.current = null;
    }
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
    }
    previewCloseTimerRef.current = setTimeout(() => {
      setPreviewFilePath(null);
      setPreviewFile(null);
      previewCloseTimerRef.current = null;
      if (isCompactLayout) {
        setMobileView("chat");
      }
    }, 220);
  }

  useEffect(() => () => {
    if (previewOpenFrameRef.current !== null) {
      cancelAnimationFrame(previewOpenFrameRef.current);
    }
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
    }
  }, []);

  // Session handlers
  const handleSelectSession = useCallback((sessionId: string) => {
    switchToChatOnMobile();
    workspace.selectSession(sessionId);
  }, [switchToChatOnMobile, workspace]);

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
  }, [refreshKnowledgePendingCount]);

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

  // Resize handlers - now work via the gap area between panels
  const handleResizeLeft = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;

    setIsDragging(true);
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveRight = rightCollapsed ? COLLAPSED_PANEL_PX + PANEL_GAP : rightWidth + PANEL_GAP;
      const maxLeft = Math.max(MIN_LEFT_PX, rect.width - effectiveRight - minCenter - PANEL_GAP);
      const nextWidth = clamp(moveEvent.clientX - rect.left, MIN_LEFT_PX, maxLeft);
      setLeftWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [rightCollapsed, rightWidth]);

  const handleResizeRight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;

    setIsDragging(true);
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveLeft = leftCollapsed ? COLLAPSED_PANEL_PX + PANEL_GAP : leftWidth + PANEL_GAP;
      const maxRight = Math.max(MIN_RIGHT_PX, rect.width - effectiveLeft - minCenter - PANEL_GAP);
      const nextWidth = clamp(rect.right - moveEvent.clientX, MIN_RIGHT_PX, maxRight);
      setRightWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [leftCollapsed, leftWidth]);

  // Load layout from localStorage (global values, ignoring legacy per-mode maps)
  useEffect(() => {
    const stored = loadStoredLayout(layoutStorageKey, layoutCookieName) ?? initialLayoutState;
    const containerWidth = getContainerWidth(containerRef.current);
    const defaultLeft = stored?.leftWidth ?? containerWidth * DEFAULT_LEFT_RATIO;
    const defaultRight = stored?.rightWidth ?? containerWidth * DEFAULT_RIGHT_RATIO;

    const fitted = fitWidths(containerWidth, defaultLeft, defaultRight);
    setLeftWidth(fitted.left);
    setRightWidth(fitted.right);
    setMinCenterWidth(fitted.minCenter);

    if (typeof stored?.leftCollapsed === "boolean") {
      setLeftCollapsed(stored.leftCollapsed);
    }
    if (typeof stored?.rightCollapsed === "boolean") {
      setRightCollapsed(stored.rightCollapsed);
    }
    if (
      stored?.rightTab === "preview" ||
      (workspaceAgentEnabled && stored?.rightTab === "review")
    ) {
      setRightTab(stored.rightTab);
    }

    setHydratedLayoutKey(layoutStorageKey);
  }, [initialLayoutState, layoutCookieName, layoutStorageKey, setLeftCollapsed, setRightCollapsed, workspaceAgentEnabled]);

  // Persist layout
  useEffect(() => {
    if (hydratedLayoutKey !== layoutStorageKey) return;
    persistLayout(layoutStorageKey, layoutCookieName, {
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed,
      rightTab: effectiveRightTab,
    });
  }, [
    effectiveRightTab,
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

  // Get theme from context
  const { themeId, isDark } = useWorkspaceTheme();

  // Build theme classes
  const darkModeClasses = isDark ? "dark" : "";
  const themeClassName = `theme-${themeId}`;

  // Loading screen while instance is starting
  if (instanceStatus !== 'running') {
    return (
      <WorkspaceStartupScreen
        slug={slug}
        instanceStatus={instanceStatus}
        instanceError={instanceError}
        macDesktopWindowInset={macDesktopWindowInset}
      />
    );
  }

  // Connecting to OpenCode screen
  if (!workspace.isConnected) {
    return (
      <WorkspaceConnectingScreen
        slug={slug}
        connection={workspace.connection}
        macDesktopWindowInset={macDesktopWindowInset}
      />
    );
  }

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
      attachmentsEnabled={workspaceAgentEnabled}
      contextFilePaths={markdownFilePaths}
      sessions={uiSessions}
      skills={skillsCatalog.skills}
      messages={uiMessages}
      permissions={workspace.permissions}
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

  const centerPanelElement = chatPanelElement;
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

  const sidebarElement = (
    <WorkspaceSidebar
      activeSessionId={activeRootSessionId}
      accountMenu={(collapsed) => (
        <WorkspaceAccountMenu
          slug={slug}
          currentVault={currentVault}
          status="active"
          collapsed={collapsed}
          onNavigateConnectors={navigateConnectors}
          onNavigateProviders={navigateProviders}
          onNavigateSettings={navigateSettings}
          onSyncComplete={handleSyncComplete}
        />
      )}
      curatorOpen={curatorOpen}
      hasMoreSessions={workspace.hasMoreSessions}
      isCollapsed={leftCollapsed}
      isInitialSessionsReady={workspace.isInitialSessionsReady}
      isLoadingMoreSessions={workspace.isLoadingMoreSessions}
      knowledgePendingCount={workspace.diffs.length + knowledgeProposalCount}
      macDesktopWindowInset={macDesktopWindowInset}
      onCreateSession={handleCreateSession}
      onLoadMoreSessions={workspace.loadMoreSessions}
      onMarkFlowRunSeen={workspace.markFlowRunSeen}
      onNavAgents={navigateAgents}
      onNavCurator={openCurator}
      onNavExplore={handleOpenExplore}
      onNavFlows={handleOpenFlowsManager}
      onNavSkills={navigateSkills}
      onSelectSession={handleSelectSession}
      onToggleCollapsed={handleToggleLeft}
      sessions={rootSessions}
      sessionsError={workspace.sessionsError}
      unseenCompletedSessions={workspace.unseenCompletedSessions}
    />
  );

  const isLeftPanelActive = mobileView === "left";
  const isChatActive = mobileView === "chat";
  const isRightPanelActive = mobileView === "right";
  const mobileLeftLabel = "Navigate";
  const mobileCenterLabel = "Chat";
  const mobileCenterAriaLabel = "Show chat";

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && 'desktop-no-select',
        darkModeClasses,
        themeClassName,
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
        onProposalCountChange={setKnowledgeProposalCount}
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
          <>
            <div className="relative min-h-0 flex-1">
              <div
                className="absolute inset-0 min-h-0 overflow-hidden px-3 pb-3"
                style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
                hidden={!isLeftPanelActive}
                aria-hidden={!isLeftPanelActive}
              >
                {sidebarElement}
              </div>

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
                  className="absolute inset-0 min-h-0 overflow-hidden px-5 pb-4"
                  style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
                  hidden={!isRightPanelActive}
                  aria-hidden={!isRightPanelActive}
                >
                  {rightPanelContent}
                </div>
              ) : null}
            </div>

            <nav
              className={cn(
                "grid shrink-0 border-t border-border/40 bg-background",
                hasRightPanel ? "grid-cols-3" : "grid-cols-2"
              )}
              style={{
                minHeight: "calc(3.5rem + env(safe-area-inset-bottom, 0px))",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }}
              aria-label="Workspace sections"
            >
              <button
                type="button"
                onClick={handleToggleLeft}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                  isLeftPanelActive
                    ? "text-foreground"
                    : "text-muted-foreground active:text-foreground"
                )}
                aria-label={isLeftPanelActive ? "Close navigate panel" : "Open navigate panel"}
                aria-pressed={isLeftPanelActive}
              >
                <Compass size={22} weight={isLeftPanelActive ? "fill" : "regular"} />
                <span>{mobileLeftLabel}</span>
              </button>

              <button
                type="button"
                onClick={handleShowChat}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                  isChatActive
                    ? "text-foreground"
                    : "text-muted-foreground active:text-foreground"
                )}
                aria-label={mobileCenterAriaLabel}
                aria-pressed={isChatActive}
              >
                <ChatCircle size={22} weight={isChatActive ? "fill" : "regular"} />
                <span>{mobileCenterLabel}</span>
              </button>

              {hasRightPanel ? (
                <button
                  type="button"
                  onClick={handleToggleRight}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                    isRightPanelActive
                      ? "text-foreground"
                      : "text-muted-foreground active:text-foreground"
                  )}
                  aria-label={isRightPanelActive ? "Close file preview" : "Open file preview"}
                  aria-pressed={isRightPanelActive}
                >
                  <div className="relative">
                    <File size={22} weight={isRightPanelActive ? "fill" : "regular"} />
                  </div>
                  <span>Preview</span>
                </button>
              ) : null}
            </nav>
          </>
        ) : (
          <WorkspacePanes
            leftCollapsed={leftCollapsed}
            leftWidth={leftWidth}
            rightCollapsed={!previewExpanded}
            rightCollapsedWidth={0}
            rightWidth={rightWidth}
            minCenterWidth={minCenterWidth}
            isDragging={isDragging}
            hasRightPanel={hasRightPanel}
            macDesktopWindowInset={macDesktopWindowInset}
            containerRef={containerRef}
            leftElement={sidebarElement}
            centerElement={centerPanelElement}
            rightElement={rightPanelContent}
            onResizeLeft={handleResizeLeft}
            onResizeRight={handleResizeRight}
          />
        )}
      </div>
    </div>
  );
}
