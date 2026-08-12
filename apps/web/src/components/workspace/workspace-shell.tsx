"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLineLeft, ArrowLineRight, ChatCircle, Circle, Compass, Database, File, Graph, SlidersHorizontal, TreeStructure } from "@phosphor-icons/react";

import { ensureInstanceRunningAction } from "@/actions/spawner";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useWorkspace } from "@/hooks/use-workspace";
import type { KnowledgeGraphAgentSource } from "@/lib/kb-graph";
import type { WorkspaceSession } from "@/lib/opencode/types";
import { getDesktopFlowsHref, getDesktopWorkspaceHref } from "@/lib/runtime/desktop/current-vault";
import {
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";
import {
  getWorkspaceSessionMode,
  getWorkspaceUnreadCounts,
  isBusyFlowWorkspaceSession,
  isFlowSession,
} from "@/lib/workspace-session-utils";
import { downloadWorkspaceFile } from "@/lib/workspace-file-download";
import { exportWorkspaceFileAsPdf } from "@/lib/workspace-file-export-pdf";
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

import { useConfigStatus } from "@/hooks/use-config-status";
import { useSkillsCatalog } from '@/hooks/use-skills-catalog'

import { ChatPanel } from "./chat-panel";
import { ConfigChangeBanner } from "./config-change-banner";
import { ArcLoader } from "./arc-loader";
import { FilePreviewPanel } from "./file-preview-panel";
import { InspectorPanel } from "./inspector-panel";
import { KnowledgeEmptyState } from "./knowledge-empty-state";
import { KnowledgeNavigationPanel, type KnowledgeNavigationView } from "./knowledge-navigation-panel";
import { FlowsEmptyState } from "./flows-empty-state";
import { WorkspaceCommandPalette } from "./workspace-command-palette";
import { WorkspaceSessionsSidebar } from "./workspace-sessions-sidebar";
import { WorkspaceSessionsRail } from "./workspace-sessions-rail";
import { WorkspaceTopNav } from "./workspace-top-nav";
import type { WorkspaceMode } from "./workspace-mode-toggle";

type WorkspaceShellProps = {
  slug: string;
  persistenceScope?: string;
  currentVault?: {
    id: string;
    name: string;
    path: string;
  } | null;
  initialFilePath?: string | null;
  initialSessionId?: string | null;
  initialWorkspaceMode?: WorkspaceMode;
  knowledgeAgentSources?: KnowledgeGraphAgentSource[];
  initialLayoutState?: StoredLayoutState | null;
  macDesktopWindowInset?: boolean;
  workspaceAgentEnabled?: boolean;
  reaperEnabled?: boolean;
};

const MIN_LEFT_PX = 200;
const MIN_RIGHT_PX = 320;
const MIN_CENTER_PX = 360;
const DEFAULT_LEFT_RATIO = 0.15;
const DEFAULT_RIGHT_RATIO = 0.3;
const PANEL_GAP = 0; // Gap between floating panels in pixels
const COLLAPSED_PANEL_PX = 48; // Width of minified (collapsed) panels
const MOBILE_LAYOUT_BREAKPOINT =
  MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX + 2 * PANEL_GAP + 48;
type MobileWorkspaceView = "chat" | "left" | "right";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const CONNECTION_ERROR_COPY: Record<string, string> = {
  connection_check_failed: "Couldn't reach the workspace. Retrying...",
  forbidden: "You are not allowed to access this workspace.",
  health_check_timeout: "The workspace is taking too long to respond. Retrying...",
  instance_unavailable: "The workspace is not ready right now. Retrying...",
  unauthorized: "Your session has expired. Sign in again.",
  unhealthy: "The workspace is not ready right now. Retrying...",
  user_not_found: "This workspace could not be found.",
};

const getConnectionErrorText = (error: string | undefined) =>
  (error && CONNECTION_ERROR_COPY[error]) || `Error: ${error ?? "unknown"}`;

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

type StoredOpenFilesState = {
  openFilePaths: string[];
  activeFilePath: string | null;
};

function getOpenFilesStorageKey(scope: string): string {
  return `arche.workspace.${scope}.open-files`;
}

const MAX_STORED_OPEN_FILES = 50;

function isValidStoredPath(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return false;
  if (isProtectedWorkspacePath(normalized)) return false;
  if (normalized.split("/").some((s) => s === "..")) return false;
  return true;
}

function loadStoredOpenFiles(key: string): StoredOpenFilesState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.openFilePaths)) return null;
    const seen = new Set<string>();
    const openFilePaths: string[] = [];
    for (const entry of record.openFilePaths) {
      if (!isValidStoredPath(entry)) continue;
      const normalized = normalizeWorkspacePath(entry);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      openFilePaths.push(normalized);
      if (openFilePaths.length >= MAX_STORED_OPEN_FILES) break;
    }
    if (openFilePaths.length === 0) return null;
    const activeFilePath =
      isValidStoredPath(record.activeFilePath) && openFilePaths.includes(normalizeWorkspacePath(record.activeFilePath as string))
        ? normalizeWorkspacePath(record.activeFilePath as string)
        : null;
    return { openFilePaths, activeFilePath };
  } catch {
    return null;
  }
}

function persistOpenFiles(key: string, state: StoredOpenFilesState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

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

// File content cache for preview panel
type FileContentCache = Record<
  string,
  {
    content: string;
    type: "raw" | "patch";
    title: string;
    updatedAt: string;
    size: string;
    hash?: string;
  }
>;

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false },
};

const PANEL_ANIM = "200ms ease-out";
const PANEL_TRANSITION = `width ${PANEL_ANIM}, min-width ${PANEL_ANIM}, opacity ${PANEL_ANIM}, margin ${PANEL_ANIM}, border-width ${PANEL_ANIM}`;
const INSTANCE_START_POLL_INTERVAL_MS = 2_000;
const INSTANCE_START_TIMEOUT_MS = 120_000;

function formatInstanceStartupError(error: string): string {
  if (error === "start_timeout") {
    return "Workspace startup timed out. Try restarting again.";
  }
  if (error === "status_check_failed") {
    return "Unable to verify workspace startup status.";
  }
  return error;
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
  initialFilePath,
  initialSessionId = null,
  initialWorkspaceMode = "chat",
  knowledgeAgentSources = [],
  initialLayoutState = null,
  macDesktopWindowInset = false,
  workspaceAgentEnabled = true,
  reaperEnabled = true,
}: WorkspaceShellProps) {
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const resolvedPersistenceScope = persistenceScope ?? slug;
  const layoutCookieName = getWorkspaceLayoutCookieName(resolvedPersistenceScope);
  const layoutStorageKey = getWorkspaceLayoutStorageKey(resolvedPersistenceScope);
  const openFilesStorageKey = getOpenFilesStorageKey(resolvedPersistenceScope);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialWorkspaceMode);
  const isExploreMode = workspaceMode === "explore";
  const isKnowledgeMode = workspaceMode === "knowledge";
  const isFlowsMode = workspaceMode === "flows";
  const lastSessionByModeRef = useRef<{ chat: string | null; flows: string | null }>({
    chat: null,
    flows: null,
  });

  // Instance startup state
  const [instanceStatus, setInstanceStatus] = useState<'starting' | 'running' | 'error' | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"preview" | "review">("preview");
  const effectiveRightTab = workspaceAgentEnabled ? rightTab : "preview";

  // Config change detection
  const configStatus = useConfigStatus(slug, instanceStatus === "running");

  // Auto-start instance on mount
  useEffect(() => {
    let cancelled = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;

    const clearTimers = () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const failStartup = (error: string) => {
      clearTimers();
      setInstanceStatus("error");
      setInstanceError(formatInstanceStartupError(error));
    };

    const checkInstanceStatus = async () => {
      if (checking) return;
      checking = true;

      try {
        const result = await ensureInstanceRunningAction(slug);
        if (cancelled) return;

        if (result.status === "error") {
          clearTimers();
          if (result.error === "setup_required") {
            routerRef.current.replace(`/u/${slug}?setup=required`);
            return;
          }
          failStartup(result.error ?? "Unknown error");
          return;
        }

        if (result.status === "running") {
          clearTimers();
          setInstanceStatus("running");
          setInstanceError(null);
          return;
        }

        setInstanceStatus("starting");

        if (!pollingTimer) {
          timeoutTimer = setTimeout(() => {
            if (cancelled) return;
            failStartup("start_timeout");
          }, INSTANCE_START_TIMEOUT_MS);

          pollingTimer = setInterval(() => {
            void checkInstanceStatus();
          }, INSTANCE_START_POLL_INTERVAL_MS);
        }
      } catch {
        if (cancelled) return;
        failStartup("status_check_failed");
      } finally {
        checking = false;
      }
    };

    void checkInstanceStatus();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [slug]);

  // Use workspace hook only when instance is running
  const workspace = useWorkspace({
    slug,
    storageScope: resolvedPersistenceScope,
    initialSessionId,
    pollInterval: 5000,
    enabled: instanceStatus === 'running',
    workspaceAgentEnabled,
    reaperEnabled,
  });
  const skillsCatalog = useSkillsCatalog(slug)
  const {
    activeSessionId: workspaceActiveSessionId,
    readFile: readWorkspaceFile,
    selectSession: selectWorkspaceSession,
  } = workspace;
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
  const [knowledgeGraphReloadKey, setKnowledgeGraphReloadKey] = useState(0);
  const reloadKnowledgeGraph = useCallback(() => {
    setKnowledgeGraphReloadKey((current) => current + 1);
  }, []);
  const refreshKnowledgeReview = useCallback(() => {
    workspace.refreshDiffs();
    workspace.refreshFiles();
    reloadKnowledgeGraph();
    void refreshKnowledgePendingCount();
  }, [refreshKnowledgePendingCount, reloadKnowledgeGraph, workspace]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, WorkspaceSession>();
    workspace.sessions.forEach((session) => {
      map.set(session.id, session);
    });
    return map;
  }, [workspace.sessions]);

  const rootSessions = useMemo(() => {
    return workspace.sessions.filter((session) => {
      if (!session.parentId) return true;
      return !sessionsById.has(session.parentId);
    });
  }, [workspace.sessions, sessionsById]);

  const { sessionsUnreadCount, flowsUnreadCount } = useMemo(
    () => getWorkspaceUnreadCounts(workspace.sessions, workspace.unseenCompletedSessions),
    [workspace.sessions, workspace.unseenCompletedSessions]
  );

  const activeRootSessionId = useMemo(
    () => resolveRootSessionId(workspace.activeSessionId, sessionsById),
    [workspace.activeSessionId, sessionsById]
  );

  // Track last active session per chat/flows mode so switching restores it
  useEffect(() => {
    const id = workspace.activeSessionId;
    if (!id) return;
    const session = sessionsById.get(id);
    if (!session) return;
    const sessionMode = getWorkspaceSessionMode(session);
    lastSessionByModeRef.current[sessionMode] = id;
  }, [workspace.activeSessionId, sessionsById]);

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

  // Layout state
  const [minCenterWidth, setMinCenterWidth] = useState(MIN_CENTER_PX);
  const buildInitialCollapseByMode = useCallback(
    (
      legacy?: boolean,
      byMode?: Record<string, boolean>,
      defaults?: Partial<Record<WorkspaceMode, boolean>>
    ): Record<WorkspaceMode, boolean> => {
      const pickMode = (mode: WorkspaceMode) => byMode?.[mode] ?? legacy ?? defaults?.[mode] ?? false;
      return {
        chat: pickMode("chat"),
        flows: pickMode("flows"),
        explore: pickMode("explore"),
        knowledge: pickMode("knowledge"),
      };
    },
    []
  );
  const buildInitialWidthByMode = useCallback(
    (legacy: number | undefined, byMode: Record<string, number> | undefined, fallback: number): Record<WorkspaceMode, number> => {
      const baseline = typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0 ? legacy : fallback;
      const pickMode = (mode: WorkspaceMode) => {
        const candidate = byMode?.[mode];
        return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
          ? candidate
          : baseline;
      };
      return {
        chat: pickMode("chat"),
        flows: pickMode("flows"),
        explore: pickMode("explore"),
        knowledge: pickMode("knowledge"),
      };
    },
    []
  );
  const [leftCollapsedByMode, setLeftCollapsedByMode] = useState<Record<WorkspaceMode, boolean>>(() =>
    buildInitialCollapseByMode(initialLayoutState?.leftCollapsed, initialLayoutState?.leftCollapsedByMode)
  );
  const [rightCollapsedByMode, setRightCollapsedByMode] = useState<Record<WorkspaceMode, boolean>>(() =>
    buildInitialCollapseByMode(initialLayoutState?.rightCollapsed, initialLayoutState?.rightCollapsedByMode)
  );
  const [leftWidthByMode, setLeftWidthByMode] = useState<Record<WorkspaceMode, number>>(() =>
    buildInitialWidthByMode(initialLayoutState?.leftWidth, initialLayoutState?.leftWidthByMode, MIN_LEFT_PX)
  );
  const [rightWidthByMode, setRightWidthByMode] = useState<Record<WorkspaceMode, number>>(() =>
    buildInitialWidthByMode(initialLayoutState?.rightWidth, initialLayoutState?.rightWidthByMode, MIN_RIGHT_PX)
  );
  const leftCollapsed = isFlowsMode || isKnowledgeMode ? false : leftCollapsedByMode[workspaceMode];
  const rightCollapsed = rightCollapsedByMode[workspaceMode];
  const leftWidth = leftWidthByMode[workspaceMode];
  const rightWidth = rightWidthByMode[workspaceMode];
  const workspaceModeRef = useRef(workspaceMode);
  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);
  const setLeftWidth = useCallback((value: number) => {
    const mode = workspaceModeRef.current;
    setLeftWidthByMode((prev) => {
      if (prev[mode] === value) return prev;
      return { ...prev, [mode]: value };
    });
  }, []);
  const setRightWidth = useCallback((value: number) => {
    const mode = workspaceModeRef.current;
    setRightWidthByMode((prev) => {
      if (prev[mode] === value) return prev;
      return { ...prev, [mode]: value };
    });
  }, []);
  const setLeftCollapsedForMode = useCallback(
    (mode: WorkspaceMode, updater: boolean | ((prev: boolean) => boolean)) => {
      setLeftCollapsedByMode((prev) => {
        const nextValue =
          typeof updater === "function" ? updater(prev[mode]) : updater;
        if (prev[mode] === nextValue) return prev;
        return { ...prev, [mode]: nextValue };
      });
    },
    []
  );
  const setRightCollapsedForMode = useCallback(
    (mode: WorkspaceMode, updater: boolean | ((prev: boolean) => boolean)) => {
      setRightCollapsedByMode((prev) => {
        const nextValue =
          typeof updater === "function" ? updater(prev[mode]) : updater;
        if (prev[mode] === nextValue) return prev;
        return { ...prev, [mode]: nextValue };
      });
    },
    []
  );
  const [knowledgeNavView, setKnowledgeNavView] = useState<KnowledgeNavigationView>("tree");
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

    if (workspaceMode === "flows" || workspaceMode === "knowledge") return;
    setLeftCollapsedForMode(workspaceMode, (prev) => !prev);
  }, [isCompactLayout, setLeftCollapsedForMode, workspaceMode]);

  const toggleRightPanel = useCallback(() => {
    if (isCompactLayout) {
      setMobileView((prev) => (prev === "right" ? "chat" : "right"));
      return;
    }

    setRightCollapsedForMode(workspaceMode, (previous) => {
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
  }, [isCompactLayout, leftCollapsed, leftWidth, setLeftWidth, setRightCollapsedForMode, setRightWidth, workspaceMode]);

  const handleToggleRight = useCallback(() => {
    toggleRightPanel();
  }, [toggleRightPanel]);

  const handleShowChat = useCallback(() => {
    setMobileView("chat");
  }, []);

  const switchToChatOnMobile = useCallback(() => {
    if (isCompactLayout) setMobileView("chat");
  }, [isCompactLayout]);

  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const previewOpenFrameRef = useRef<number | null>(null);
  const previewCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWorkspaceModeChange = useCallback(
    (nextMode: WorkspaceMode) => {
      const resolvedNextMode = nextMode;
      const prevMode = workspaceMode;
      setWorkspaceMode(resolvedNextMode);

      if (resolvedNextMode === "explore") {
        setPreviewFilePath(null);
      }

      if (prevMode !== resolvedNextMode) {
        const currentActiveId = workspaceActiveSessionId;
        const currentSession = currentActiveId
          ? sessionsById.get(currentActiveId) ?? null
          : null;
        const currentIsFlow = isFlowSession(currentSession);

        if (resolvedNextMode === "chat" && currentIsFlow) {
          const targetId = lastSessionByModeRef.current.chat;
          if (targetId !== currentActiveId) {
            selectWorkspaceSession(targetId);
          }
        } else if (resolvedNextMode === "flows" && !currentIsFlow) {
          // Only switch the active session if we have a remembered flow to
          // restore. If not, leave the session as-is so the workspace hook
          // does not auto-reselect a chat session in the background.
          const targetId = lastSessionByModeRef.current.flows;
          if (targetId && targetId !== currentActiveId) {
            selectWorkspaceSession(targetId);
          }
        }
      }

      if (isCompactLayout) {
        setMobileView("chat");
      }

      if (typeof window === "undefined") return;

      const params = new URLSearchParams(window.location.search);
      if (resolvedNextMode === "explore" || resolvedNextMode === "knowledge") {
        params.set("mode", resolvedNextMode);
      } else if (resolvedNextMode === "flows") {
        params.set("mode", "flows");
      } else {
        params.delete("mode");
      }

      const query = params.toString();
      window.history.replaceState(window.history.state, "", query ? `/w/${slug}?${query}` : `/w/${slug}`);
    },
    [isCompactLayout, selectWorkspaceSession, sessionsById, slug, workspaceActiveSessionId, workspaceMode]
  );

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
        } else if (workspaceMode !== "flows") {
          setLeftCollapsedForMode(workspaceMode, (prev) => !prev);
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
  }, [handleCreateSession, isCompactLayout, setLeftCollapsedForMode, toggleRightPanel, workspaceMode]);

  // File viewing state
  const safeInitialFilePath = useMemo(() => {
    if (!initialFilePath) return null;
    if (!isValidStoredPath(initialFilePath)) return null;
    return normalizeWorkspacePath(initialFilePath);
  }, [initialFilePath]);

  const [openFilePaths, setOpenFilePaths] = useState<string[]>(() => {
    const stored = loadStoredOpenFiles(openFilesStorageKey);
    const storedPaths = stored?.openFilePaths ?? [];
    if (!safeInitialFilePath) return storedPaths;
    if (storedPaths.includes(safeInitialFilePath)) return storedPaths;
    return [...storedPaths, safeInitialFilePath];
  });
  const [activeFilePath, setActiveFilePath] = useState<string | null>(() => {
    if (safeInitialFilePath) return safeInitialFilePath;
    const stored = loadStoredOpenFiles(openFilesStorageKey);
    if (!stored?.activeFilePath) return stored?.openFilePaths?.[0] ?? null;
    return stored.openFilePaths.includes(stored.activeFilePath)
      ? stored.activeFilePath
      : stored.openFilePaths[0] ?? null;
  });
  const [fileCache, setFileCache] = useState<FileContentCache>({});
  const fileCacheRef = useRef(fileCache);

  useEffect(() => {
    fileCacheRef.current = fileCache;
  }, [fileCache]);

  const initialOpenFilePathsRef = useRef(openFilePaths);
  const hasRestoredFilesRef = useRef(false);
  useEffect(() => {
    if (hasRestoredFilesRef.current) return;
    if (!workspace.isConnected) return;
    const paths = initialOpenFilePathsRef.current;
    if (paths.length === 0) {
      hasRestoredFilesRef.current = true;
      return;
    }
    hasRestoredFilesRef.current = true;

    void Promise.all(
      paths.map(async (path) => {
        try {
          const result = await readWorkspaceFile(path);
          if (result) {
            setFileCache((prev) => {
              if (prev[path]) return prev;
              return {
                ...prev,
                [path]: {
                  content: result.content,
                  type: result.type,
                  title: path.split("/").pop() ?? path,
                  updatedAt: "Just now",
                  size: `${(result.content.length / 1024).toFixed(1)} KB`,
                  hash: result.hash,
                },
              };
            });
          } else {
            setFileCache((prev) => ({
              ...prev,
              [path]: {
                content: "Unable to load file.",
                type: "raw",
                title: path.split("/").pop() ?? path,
                updatedAt: "Error",
                size: "0 KB",
              },
            }));
          }
        } catch {
          setFileCache((prev) => ({
            ...prev,
            [path]: {
              content: "Unable to load file.",
              type: "raw",
              title: path.split("/").pop() ?? path,
              updatedAt: "Error",
              size: "0 KB",
            },
          }));
        }
      })
    );
  }, [workspace.isConnected, readWorkspaceFile]);

  useEffect(() => {
    persistOpenFiles(openFilesStorageKey, { openFilePaths, activeFilePath });
  }, [openFilesStorageKey, openFilePaths, activeFilePath]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);

    if (activeFilePath) {
      params.set("path", activeFilePath);
    } else {
      params.delete("path");
    }

    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `/w/${slug}?${query}` : `/w/${slug}`);
  }, [activeFilePath, slug]);

  const refreshOpenFilesCache = useCallback(async () => {
    if (openFilePaths.length === 0) return;

    const updates = await Promise.all(
      openFilePaths.map(async (path) => ({
        path,
        result: await workspace.readFile(path),
      }))
    );

    setFileCache((prev) => {
      let changed = false;
      const next = { ...prev };

      updates.forEach(({ path, result }) => {
        if (!result) return;
        changed = true;
         next[path] = {
           content: result.content,
           type: result.type,
           title: path.split("/").pop() ?? path,
           updatedAt: "Just now",
           size: `${(result.content.length / 1024).toFixed(1)} KB`,
           hash: result.hash,
         };
       });

      return changed ? next : prev;
    });
  }, [openFilePaths, workspace]);

  const handleSyncComplete = useCallback((status: SyncKbResult["status"]) => {
    refreshKnowledgeReview();

    if (status === "synced") {
      void refreshOpenFilesCache();
    }
  }, [refreshKnowledgeReview, refreshOpenFilesCache]);

  const handlePublishComplete = useCallback(() => {
    refreshKnowledgeReview();
  }, [refreshKnowledgeReview]);

  const handleResolveConflict = useCallback(
    async (path: string) => {
      refreshKnowledgeReview();

      if (!fileCacheRef.current[path]) return;

      const refreshed = await workspace.readFile(path);

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        if (!refreshed) {
          const next = { ...prev };
          delete next[path];
          return next;
        }

        return {
          ...prev,
          [path]: {
            ...existing,
            content: refreshed.content,
            type: refreshed.type,
            updatedAt: "Just now",
            size: `${(refreshed.content.length / 1024).toFixed(1)} KB`,
            hash: refreshed.hash,
          },
        };
      });

      if (!refreshed) {
        setOpenFilePaths((prev) => {
          const nextOpen = prev.filter((candidate) => candidate !== path);
          setActiveFilePath((active) => {
            if (active !== path) return active;
            return nextOpen[0] ?? null;
          });
          return nextOpen;
        });
      }
    },
    [refreshKnowledgeReview, workspace]
  );

  const handleSaveFile = useCallback(
    async (path: string, content: string, expectedHash?: string) => {
      const hashToUse = expectedHash ?? fileCacheRef.current[path]?.hash;
      const result = await workspace.writeFile(path, content, hashToUse);
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "save_failed" };
      }

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        const size = `${(content.length / 1024).toFixed(1)} KB`;
        return {
          ...prev,
          [path]: {
            ...existing,
            content,
            updatedAt: "Just now",
            size,
            hash: result.hash ?? existing.hash,
          },
        };
      });

      refreshKnowledgeReview();

      return { ok: true as const, hash: result.hash };
    },
    [refreshKnowledgeReview, workspace]
  );

  const handleReloadFile = useCallback(
    async (path: string) => {
      const result = await workspace.readFile(path);
      if (!result) return;

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        return {
          ...prev,
          [path]: {
            ...existing,
            content: result.content,
            type: result.type,
            updatedAt: "Just now",
            size: `${(result.content.length / 1024).toFixed(1)} KB`,
            hash: result.hash,
          },
        };
      });
    },
    [workspace]
  );

  const handleDiscardFileChanges = useCallback(
    async (path: string) => {
      const result = await workspace.discardFileChanges(path);
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "discard_failed" };
      }

      const refreshed = await workspace.readFile(path);

      setFileCache((prev) => {
        const next = { ...prev };
        if (!refreshed) {
          delete next[path];
          return next;
        }
        const existing = next[path];
        if (!existing) return prev;

        next[path] = {
          ...existing,
          content: refreshed.content,
          type: refreshed.type,
          updatedAt: "Just now",
          size: `${(refreshed.content.length / 1024).toFixed(1)} KB`,
          hash: refreshed.hash,
        };
        return next;
      });

      if (!refreshed) {
        setOpenFilePaths((prev) => {
          const nextOpen = prev.filter((candidate) => candidate !== path);
          setActiveFilePath((active) => {
            if (active !== path) return active;
            return nextOpen[0] ?? null;
          });
          return nextOpen;
        });
      }

      refreshKnowledgeReview();

      return { ok: true as const };
    },
    [refreshKnowledgeReview, workspace]
  );

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

  const diffSignature = useMemo(() => {
    if (workspace.diffs.length === 0) return '';
    return workspace.diffs
      .map(
        (diff) =>
          `${diff.path}:${diff.status}:${diff.additions}:${diff.deletions}:${diff.conflicted ? 1 : 0}:${diff.diff}`
      )
      .sort()
      .join('|');
  }, [workspace.diffs]);

  const lastDiffSignatureRef = useRef<string>('');

  useEffect(() => {
    if (!workspace.isConnected) return;
    if (lastDiffSignatureRef.current === diffSignature) return;

    lastDiffSignatureRef.current = diffSignature;
    workspace.refreshFiles();

    if (openFilePaths.length === 0) return;

    openFilePaths.forEach((path) => {
      void workspace.readFile(path).then((result) => {
        if (!result) return;
        setFileCache((prev) => ({
          ...prev,
          [path]: {
            content: result.content,
            type: result.type,
            title: path.split('/').pop() ?? path,
            updatedAt: 'Just now',
            size: `${(result.content.length / 1024).toFixed(1)} KB`,
            hash: result.hash,
          },
        }));
      });
    });
  }, [diffSignature, openFilePaths, workspace, workspace.isConnected, workspace.readFile, workspace.refreshFiles]);

  // Load layout from localStorage
  useEffect(() => {
    const stored = loadStoredLayout(layoutStorageKey, layoutCookieName) ?? initialLayoutState;
    const containerWidth = getContainerWidth(containerRef.current);
    const defaultLeft = containerWidth * DEFAULT_LEFT_RATIO;
    const defaultRight = containerWidth * DEFAULT_RIGHT_RATIO;

    const initialLeftByMode = buildInitialWidthByMode(
      stored?.leftWidth ?? defaultLeft,
      stored?.leftWidthByMode,
      defaultLeft
    );
    const initialRightByMode = buildInitialWidthByMode(
      stored?.rightWidth ?? defaultRight,
      stored?.rightWidthByMode,
      defaultRight
    );

    const fittedLeftByMode: Record<WorkspaceMode, number> = { ...initialLeftByMode };
    const fittedRightByMode: Record<WorkspaceMode, number> = { ...initialRightByMode };
    const modes: WorkspaceMode[] = ["chat", "flows", "explore", "knowledge"];
    let activeFitted = fitWidths(containerWidth, initialLeftByMode[workspaceMode], initialRightByMode[workspaceMode]);
    for (const mode of modes) {
      const fitted = fitWidths(containerWidth, initialLeftByMode[mode], initialRightByMode[mode]);
      fittedLeftByMode[mode] = fitted.left;
      fittedRightByMode[mode] = fitted.right;
      if (mode === workspaceMode) {
        activeFitted = fitted;
      }
    }

    setLeftWidthByMode(fittedLeftByMode);
    setRightWidthByMode(fittedRightByMode);
    setMinCenterWidth(activeFitted.minCenter);

    if (
      typeof stored?.leftCollapsed === "boolean" ||
      stored?.leftCollapsedByMode
    ) {
      setLeftCollapsedByMode(
        buildInitialCollapseByMode(stored?.leftCollapsed, stored?.leftCollapsedByMode)
      );
    }
    if (
      typeof stored?.rightCollapsed === "boolean" ||
      stored?.rightCollapsedByMode
    ) {
      setRightCollapsedByMode(
        buildInitialCollapseByMode(stored?.rightCollapsed, stored?.rightCollapsedByMode, { chat: true })
      );
    }
    if (
      stored?.rightTab === "preview" ||
      (workspaceAgentEnabled && stored?.rightTab === "review")
    ) {
      setRightTab(stored.rightTab);
    }

    setHydratedLayoutKey(layoutStorageKey);
  }, [buildInitialCollapseByMode, buildInitialWidthByMode, initialLayoutState, layoutCookieName, layoutStorageKey, workspaceAgentEnabled, workspaceMode]);

  // Re-fit the active mode's widths on mode switch so a previously-stored
  // width does not overflow if the container is now narrower.
  useEffect(() => {
    if (hydratedLayoutKey !== layoutStorageKey) return;
    const containerWidth = getContainerWidth(containerRef.current);
    const fitted = fitWidths(
      containerWidth,
      leftWidthByMode[workspaceMode],
      rightWidthByMode[workspaceMode]
    );
    setLeftWidthByMode((prev) =>
      prev[workspaceMode] === fitted.left ? prev : { ...prev, [workspaceMode]: fitted.left }
    );
    setRightWidthByMode((prev) =>
      prev[workspaceMode] === fitted.right ? prev : { ...prev, [workspaceMode]: fitted.right }
    );
    setMinCenterWidth(fitted.minCenter);
    // Intentionally exclude width state from deps so we only refit on mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedLayoutKey, layoutStorageKey, workspaceMode]);

  // Persist layout
  useEffect(() => {
    if (hydratedLayoutKey !== layoutStorageKey) return;
    persistLayout(layoutStorageKey, layoutCookieName, {
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed,
      leftCollapsedByMode,
      rightCollapsedByMode,
      leftWidthByMode,
      rightWidthByMode,
      rightTab: effectiveRightTab,
    });
  }, [
    effectiveRightTab,
    hydratedLayoutKey,
    layoutCookieName,
    layoutStorageKey,
    leftCollapsed,
    leftCollapsedByMode,
    leftWidth,
    leftWidthByMode,
    rightCollapsed,
    rightCollapsedByMode,
    rightWidth,
    rightWidthByMode,
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

  // Open files from cache for preview
  const openFiles = useMemo(() => {
    return openFilePaths
      .map(path => {
        const cached = fileCache[path];
        if (!cached) return null;
        return {
          path,
          title: path.split('/').pop() ?? path,
          content: cached.content,
          updatedAt: cached.updatedAt,
          size: cached.size,
          hash: cached.hash,
          kind: path.endsWith('.md') ? 'markdown' as const : 'text' as const
        };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
  }, [openFilePaths, fileCache]);

  // File handlers
  const handleOpenFile = useCallback(
    async (path: string, options?: { forceExploreMode?: boolean }) => {
      const resolvedPath = resolveFilePath(path);
      const pathToOpen = resolvedPath || path;
      const normalizedPath = normalizeWorkspacePath(pathToOpen);

      if (!normalizedPath || isProtectedWorkspacePath(normalizedPath)) {
        return;
      }

      const shouldOpenInExplore = options?.forceExploreMode || isExploreMode;
      if (options?.forceExploreMode && !isExploreMode) {
        handleWorkspaceModeChange("explore");
      }

      if (shouldOpenInExplore) {
        setOpenFilePaths(prev => prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]);
        setActiveFilePath(normalizedPath);
        setRightTab("preview");
        if (isCompactLayout) {
          setMobileView("chat");
        }
      } else {
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
        setRightCollapsedForMode(workspaceMode, false);
        if (isCompactLayout) {
          setMobileView("right");
        }
      }

      // Load file content if not cached
      if (!fileCacheRef.current[normalizedPath]) {
        const result = await readWorkspaceFile(normalizedPath);
        if (result) {
          setFileCache(prev => ({
            ...prev,
             [normalizedPath]: {
                content: result.content,
                type: result.type,
                title: normalizedPath.split('/').pop() ?? normalizedPath,
                updatedAt: 'Just now',
                size: `${(result.content.length / 1024).toFixed(1)} KB`,
                hash: result.hash,
              }
           }));
         } else {
           setFileCache(prev => ({
             ...prev,
             [normalizedPath]: {
                content: 'Unable to load file.',
                type: 'raw',
                title: normalizedPath.split('/').pop() ?? normalizedPath,
                updatedAt: 'Error',
                size: '0 KB',
              }
           }));
          }
        }
      },
    [
      handleWorkspaceModeChange,
      isCompactLayout,
      isExploreMode,
      resolveFilePath,
      readWorkspaceFile,
      setRightCollapsedForMode,
      workspaceMode,
    ]
  );

  const handleCommandPaletteOpenFile = useCallback(
    (path: string) => handleOpenFile(path, { forceExploreMode: true }),
    [handleOpenFile]
  );

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
      previewCloseTimerRef.current = null;
      if (isCompactLayout) {
        setMobileView("chat");
      }
    }, 220);
  }

  function handleEditFromPreview() {
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
    setOpenFilePaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFilePath(path);
    setRightTab("preview");
    setPreviewExpanded(false);
    setPreviewFilePath(null);
    handleWorkspaceModeChange("explore");
  }

  useEffect(() => () => {
    if (previewOpenFrameRef.current !== null) {
      cancelAnimationFrame(previewOpenFrameRef.current);
    }
    if (previewCloseTimerRef.current) {
      clearTimeout(previewCloseTimerRef.current);
    }
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setActiveFilePath(path);
    setRightTab("preview");
  }, []);

  const handleCloseFile = useCallback((path: string) => {
    setOpenFilePaths(prev => {
      const filtered = prev.filter(p => p !== path);
      if (path === activeFilePath) {
        setActiveFilePath(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }
      return filtered;
    });
  }, [activeFilePath]);

  // Session handlers
  const handleSelectSession = useCallback((sessionId: string) => {
    switchToChatOnMobile();
    workspace.selectSession(sessionId);
  }, [switchToChatOnMobile, workspace]);

  const handleCommandPaletteSelectSession = useCallback(
    (sessionId: string, mode: WorkspaceMode) => {
      handleWorkspaceModeChange(mode);
      switchToChatOnMobile();
      workspace.selectSession(sessionId);
    },
    [handleWorkspaceModeChange, switchToChatOnMobile, workspace]
  );

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
              label: "View in Knowledge",
              onClick: () => handleWorkspaceModeChange("knowledge"),
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
    [handleWorkspaceModeChange, refreshKnowledgePendingCount, slug]
  );

  const handleLearningProposalSentToReview = useCallback(() => {
    refreshKnowledgeReview();
    void refreshOpenFilesCache();
  }, [refreshKnowledgeReview, refreshOpenFilesCache]);

  const handleFlowHumanResponseSubmitted = useCallback(async () => {
    await Promise.all([
      workspace.refreshMessages(),
      workspace.refreshSessions(),
    ]);
  }, [workspace]);

  const handleDownloadFile = useCallback(
    (path: string) => {
      downloadWorkspaceFile(slug, path);
    },
    [slug]
  );

  const handleExportFilePdf = useCallback(
    async (path: string) => {
      const toastId = `pdf-export:${path}`;
      toast.loading("Exporting PDF…", { id: toastId });
      const result = await exportWorkspaceFileAsPdf(slug, path);
      if (result.ok) {
        toast.success("PDF exported", { id: toastId });
      } else if (result.error === "export_busy") {
        toast.error("Another PDF export is already in progress", { id: toastId });
      } else if (result.error === "file_too_large") {
        toast.error("The document is too large to export", { id: toastId });
      } else if (result.error === "bundle_too_large") {
        toast.error("The document bundle is too large to export", { id: toastId });
      } else if (result.error === "export_timeout") {
        toast.error("PDF export timed out; try again", { id: toastId });
      } else {
        toast.error("PDF export failed", { id: toastId });
      }
    },
    [slug]
  );

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
  }, [rightCollapsed, rightWidth, setLeftWidth]);

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
  }, [leftCollapsed, leftWidth, setRightWidth]);

  // Get theme from context
  const { themeId, isDark } = useWorkspaceTheme();

  // Build theme classes
  const darkModeClasses = isDark ? "dark" : "";
  const themeClassName = `theme-${themeId}`;

  // Loading screen while instance is starting
  if (instanceStatus !== 'running') {
    const loadingStatus = instanceStatus === 'starting' ? 'provisioning' : 'offline';
    const loadingStyle = statusConfig[loadingStatus as keyof typeof statusConfig];
    const showInstanceHeader = instanceStatus === 'error';
    return (
      <div
        className={cn(
          'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
          macDesktopWindowInset && 'pt-8',
          darkModeClasses,
          themeClassName,
        )}
      >
        <div className="flex h-full flex-col p-3">
          {showInstanceHeader && (
            <div className="flex items-center gap-2 p-4">
              <span className="type-display text-base font-semibold tracking-tight">Arche</span>
              <span className="text-sm text-muted-foreground">/</span>
              <span className="text-sm text-muted-foreground">{slug}</span>
              <Circle size={8} weight="fill" className={cn(loadingStyle.color, loadingStyle.pulse && "animate-pulse")} />
            </div>
          )}

          <div className="relative z-10 flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
              {instanceStatus === 'starting' && (
                <>
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="type-display text-xl font-semibold">
                      Starting workspace
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Preparing your development environment...
                    </p>
                  </div>
                </>
              )}
              {instanceStatus === 'error' && (
                <>
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                    <span className="text-2xl">!</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="type-display text-xl font-semibold text-destructive">
                      Failed to start
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {instanceError ?? 'Unable to start the workspace'}
                    </p>
                  </div>
                </>
              )}
              {instanceStatus === null && (
                <>
                  <ArcLoader />
                  <div className="space-y-2">
                    <h2 className="type-display text-xl font-semibold">
                      Connecting...
                    </h2>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Connecting to OpenCode screen
  if (!workspace.isConnected) {
    const connectingStyle = statusConfig.provisioning;
    const showConnectingHeader = workspace.connection.status === 'error';
    return (
      <div
        className={cn(
          'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
          macDesktopWindowInset && 'pt-8',
          darkModeClasses,
          themeClassName,
        )}
      >
        <div className="flex h-full flex-col p-3">
          {showConnectingHeader && (
            <div className="flex items-center gap-2 p-4">
              <span className="type-display text-base font-semibold tracking-tight">Arche</span>
              <span className="text-sm text-muted-foreground">/</span>
              <span className="text-sm text-muted-foreground">{slug}</span>
              <Circle size={8} weight="fill" className={cn(connectingStyle.color, connectingStyle.pulse && "animate-pulse")} />
            </div>
          )}

          <div className="relative z-10 flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
              <ArcLoader />
              <div className="space-y-2">
                <h2 className="type-display text-xl font-semibold">
                  Connecting to OpenCode
                </h2>
                <p className="text-sm text-muted-foreground">
                  {workspace.connection.status === 'error'
                    ? getConnectionErrorText(workspace.connection.error)
                    : 'Establishing connection...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const navigateSettings = () => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'providers') : `/u/${slug}/settings`,
    );
  };

  const navigateConnectors = () => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'connectors') : `/u/${slug}/connectors`,
    );
  };

  const navigateProviders = () => {
    router.push(
      currentVault ? getDesktopWorkspaceHref(slug, 'providers') : `/u/${slug}/settings`,
    );
  };

  const leftPanelModeLabel = isExploreMode ? "explore" : isFlowsMode ? "flows" : "sessions";

  const collapseLeftButton = !isCompactLayout && !isFlowsMode && !isKnowledgeMode ? (
    <button
      type="button"
      onClick={handleToggleLeft}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
      aria-label={`Collapse ${leftPanelModeLabel} panel`}
      title="Collapse panel"
    >
      <ArrowLineLeft size={13} weight="bold" />
    </button>
  ) : null;

  const flowsSettingsButton = !isCompactLayout && isFlowsMode ? (
    <button
      type="button"
      onClick={() => router.push(currentVault ? getDesktopFlowsHref(slug, 'list') : `/u/${slug}/flows`)}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
      aria-label="Manage flows"
      title="Manage flows"
    >
      <SlidersHorizontal size={13} weight="bold" />
    </button>
  ) : null;

  const leftPanelHeaderActions = collapseLeftButton ?? flowsSettingsButton;

  const leftPanelCoreElement = isExploreMode ? (
    <KnowledgeNavigationPanel
      activeFilePath={activeFilePath}
      agentSources={knowledgeAgentSources}
      fileNodes={workspace.fileTree}
      headerActions={leftPanelHeaderActions}
      onDownloadFile={handleDownloadFile}
      onExportFilePdf={handleExportFilePdf}
      onOpenFile={(path) => {
        void handleOpenFile(path, { forceExploreMode: true })
      }}
      openFiles={openFiles}
      readFile={workspace.readFile}
      reloadKey={knowledgeGraphReloadKey}
      view={knowledgeNavView}
      onViewChange={setKnowledgeNavView}
    />
  ) : (
    <WorkspaceSessionsSidebar
      slug={slug}
      kind={isFlowsMode ? "flows" : "chats"}
      sessions={rootSessions}
      activeSessionId={activeRootSessionId}
      hasMoreSessions={workspace.hasMoreSessions}
      isInitialSessionsReady={workspace.isInitialSessionsReady}
      isLoadingMoreSessions={workspace.isLoadingMoreSessions}
      sessionsError={workspace.sessionsError}
      unseenCompletedSessions={workspace.unseenCompletedSessions}
      headerActions={leftPanelHeaderActions}
      onCreateSession={handleCreateSession}
      onLoadMoreSessions={workspace.loadMoreSessions}
      onMarkFlowRunSeen={workspace.markFlowRunSeen}
      onRunFlowComplete={workspace.refreshSessions}
      onSelectSession={handleSelectSession}
    />
  );

  const leftPanelElement = leftCollapsed && !isCompactLayout ? (
    <div className="flex h-full w-full flex-col items-center py-2 text-card-foreground">
      <button
        type="button"
        onClick={handleToggleLeft}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        aria-label={`Expand ${leftPanelModeLabel} panel`}
      >
        <ArrowLineRight size={13} weight="bold" />
      </button>
      <div className="my-2 h-px w-6 bg-border/40" />
      {isExploreMode ? (
        <>
          <button
            type="button"
            onClick={() => {
              setKnowledgeNavView("tree");
              setLeftCollapsedForMode(workspaceMode, false);
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/5 hover:text-foreground",
              knowledgeNavView === "tree" ? "text-foreground" : "text-muted-foreground"
            )}
            aria-label="Show tree view"
            title="Tree"
          >
            <TreeStructure size={13} weight={knowledgeNavView === "tree" ? "fill" : "bold"} />
          </button>
          <button
            type="button"
            onClick={() => {
              setKnowledgeNavView("graph");
              setLeftCollapsedForMode(workspaceMode, false);
            }}
            className={cn(
              "mt-0.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/5 hover:text-foreground",
              knowledgeNavView === "graph" ? "text-foreground" : "text-muted-foreground"
            )}
            aria-label="Show graph view"
            title="Graph"
          >
            <Graph size={13} weight={knowledgeNavView === "graph" ? "fill" : "bold"} />
          </button>
        </>
      ) : (
        <WorkspaceSessionsRail
          kind={isFlowsMode ? "flows" : "chats"}
          sessions={rootSessions}
          activeSessionId={activeRootSessionId}
          unseenCompletedSessions={workspace.unseenCompletedSessions}
          onSelectSession={handleSelectSession}
          onMarkFlowRunSeen={workspace.markFlowRunSeen}
        />
      )}
    </div>
  ) : (
    <div className="h-full min-h-0">
      {leftPanelCoreElement}
    </div>
  );

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
      activeSessionId={workspace.activeSessionId}
      isInitialSessionsReady={workspace.isInitialSessionsReady}
      isLoadingMessages={workspace.isLoadingMessages}
      sessionsError={workspace.sessionsError}
      isStartingNewSession={workspace.isStartingNewSession}
      sessionTabs={activeSessionTabs}
      openFilePaths={openFilePaths}
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

  const fileEditorPanelElement = (
    <InspectorPanel
      slug={slug}
      panelMode="files"
      workspaceAgentEnabled={workspaceAgentEnabled}
      onTabChange={setRightTab}
      rightCollapsed={false}
      onToggleRight={handleToggleRight}
      hideCollapseButton
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      onSelectFile={handleSelectFile}
      onCloseFile={handleCloseFile}
      diffs={workspace.diffs}
      isLoadingDiffs={workspace.isLoadingDiffs}
      diffsError={workspace.diffsError}
      onOpenFile={handleOpenFile}
      onKnowledgeReviewApplied={handleLearningProposalSentToReview}
      knowledgeReviewRefreshKey={learningRefreshKey}
      internalLinkPaths={markdownFilePaths}
      onReloadFile={handleReloadFile}
      onSaveFile={workspaceAgentEnabled ? handleSaveFile : undefined}
      onDiscardFileChanges={workspaceAgentEnabled ? handleDiscardFileChanges : undefined}
      onPublish={workspaceAgentEnabled ? handlePublishComplete : undefined}
      onResolveConflict={workspaceAgentEnabled ? handleResolveConflict : undefined}
    />
  );

  const reviewPanelElement = (
    <InspectorPanel
      slug={slug}
      panelMode="knowledge"
      workspaceAgentEnabled={workspaceAgentEnabled}
      onTabChange={setRightTab}
      rightCollapsed={false}
      onToggleRight={() => undefined}
      hideCollapseButton
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      onSelectFile={handleSelectFile}
      onCloseFile={handleCloseFile}
      diffs={workspace.diffs}
      isLoadingDiffs={workspace.isLoadingDiffs}
      diffsError={workspace.diffsError}
      onOpenFile={(path) => {
        void handleOpenFile(path, { forceExploreMode: true })
      }}
      onKnowledgeReviewApplied={handleLearningProposalSentToReview}
      onKnowledgeReviewChanged={refreshKnowledgePendingCount}
      knowledgeReviewRefreshKey={learningRefreshKey}
      internalLinkPaths={markdownFilePaths}
      onReloadFile={handleReloadFile}
      onSaveFile={workspaceAgentEnabled ? handleSaveFile : undefined}
      onDiscardFileChanges={workspaceAgentEnabled ? handleDiscardFileChanges : undefined}
      onPublish={workspaceAgentEnabled ? handlePublishComplete : undefined}
      onResolveConflict={workspaceAgentEnabled ? handleResolveConflict : undefined}
    />
  );

  const isViewingFlowSession = isFlowSession(activeSessionRecord);
  const showFlowsEmptyState = isFlowsMode && !isViewingFlowSession;
  const showExploreEmptyState = isExploreMode && openFilePaths.length === 0;
  const centerPanelElement = isKnowledgeMode
    ? reviewPanelElement
    : isExploreMode
      ? showExploreEmptyState
        ? <KnowledgeEmptyState />
        : fileEditorPanelElement
    : showFlowsEmptyState
      ? <FlowsEmptyState />
      : chatPanelElement;
  const previewCacheEntry = previewFilePath ? fileCache[previewFilePath] : null;
  const previewPanelElement = previewFilePath ? (
    <FilePreviewPanel
      path={previewFilePath}
      content={previewCacheEntry?.content ?? ''}
      isLoading={!previewCacheEntry}
      onClose={handleClosePreview}
      onEdit={handleEditFromPreview}
    />
  ) : null;
  const hasPreviewPanel = !isExploreMode && !isKnowledgeMode && previewFilePath !== null;
  const hasRightPanel = hasPreviewPanel;
  const rightPanelContent = previewPanelElement;

  const isLeftPanelActive = mobileView === "left";
  const isChatActive = mobileView === "chat";
  const isRightPanelActive = mobileView === "right";
  const mobileLeftLabel = isExploreMode ? "Tree" : isFlowsMode ? "Flows" : "Sessions";
  const mobileCenterLabel = isExploreMode ? "Files" : "Chat";
  const mobileCenterAriaLabel = isExploreMode ? "Show files" : "Show chat";

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
        onModeChange={handleWorkspaceModeChange}
        onOpenFile={handleCommandPaletteOpenFile}
        onNavigateConnectors={navigateConnectors}
        onNavigateProviders={navigateProviders}
        onNavigateSettings={navigateSettings}
        onRefreshSessions={workspace.refreshSessions}
        onSelectSession={handleCommandPaletteSelectSession}
        onToggleLeftPanel={handleToggleLeft}
      />
      <WorkspaceTopNav
        slug={slug}
        currentVault={currentVault}
        mode={workspaceMode}
        status="active"
        sessionsUnreadCount={sessionsUnreadCount}
        flowsUnreadCount={flowsUnreadCount}
        knowledgePendingCount={workspace.diffs.length + knowledgeProposalCount}
        macDesktopWindowInset={macDesktopWindowInset}
        onModeChange={handleWorkspaceModeChange}
        onNavigateConnectors={navigateConnectors}
        onNavigateProviders={navigateProviders}
        onNavigateSettings={navigateSettings}
        onSyncComplete={handleSyncComplete}
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
      <div className="flex min-h-0 flex-1 flex-col pl-1">
        {isCompactLayout ? isKnowledgeMode ? (
          <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
            {centerPanelElement}
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                className="absolute inset-0 min-h-0 overflow-hidden px-3 pb-3"
                style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
                hidden={!isLeftPanelActive}
                aria-hidden={!isLeftPanelActive}
              >
                {leftPanelElement}
              </div>

              <div
                className="absolute inset-0 min-h-0 overflow-hidden"
                style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
                hidden={!isChatActive}
                aria-hidden={!isChatActive}
              >
                <div
                  className={cn(
                    "h-full min-h-0 overflow-hidden",
                    isExploreMode && "px-3 pb-3 pt-2"
                  )}
                >
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
                {isExploreMode ? (
                  <Database size={22} weight={isChatActive ? "fill" : "regular"} />
                ) : (
                  <ChatCircle size={22} weight={isChatActive ? "fill" : "regular"} />
                )}
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
          <div ref={containerRef} className="relative z-10 flex min-h-0 flex-1">
            {!isKnowledgeMode ? (
              <>
                <div
                  className="shrink-0 overflow-hidden border-r border-border/30"
                  style={{
                    width: leftCollapsed ? COLLAPSED_PANEL_PX : leftWidth,
                    minWidth: leftCollapsed ? COLLAPSED_PANEL_PX : MIN_LEFT_PX,
                    opacity: 1,
                    transition: isDragging ? "none" : PANEL_TRANSITION,
                  }}
                >
                  {leftPanelElement}
                </div>

                {!leftCollapsed && (
                  <div
                    className="absolute bottom-0 top-0 z-20 w-6 cursor-col-resize"
                    style={{ left: leftWidth - 3 }}
                    onPointerDown={handleResizeLeft}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize left panel"
                  />
                )}
              </>
            ) : null}

            <div
              className="flex min-w-0 flex-1 items-stretch justify-center"
              style={{ minWidth: hasRightPanel ? minCenterWidth : 0 }}
            >
              <div
                className={cn(
                  "h-full w-full min-w-0 overflow-hidden",
                  hasRightPanel && "border-r border-border/30"
                )}
              >
                {centerPanelElement}
              </div>
            </div>

            {hasRightPanel && !rightCollapsed && (
              <div
                className="absolute bottom-0 top-0 z-20 w-6 cursor-col-resize"
                style={{ right: rightWidth - 3 }}
                onPointerDown={handleResizeRight}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
              />
            )}

            {hasRightPanel ? (
              <div
                className="shrink-0 overflow-hidden box-border"
                style={{
                  width: hasPreviewPanel
                    ? (previewExpanded ? rightWidth : 0)
                    : (rightCollapsed ? COLLAPSED_PANEL_PX : rightWidth),
                  minWidth: hasPreviewPanel
                    ? (previewExpanded ? MIN_RIGHT_PX : 0)
                    : (rightCollapsed ? COLLAPSED_PANEL_PX : MIN_RIGHT_PX),
                  opacity: 1,
                  transition: isDragging ? "none" : PANEL_TRANSITION,
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
