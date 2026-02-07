"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureInstanceRunningAction } from "@/actions/spawner";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useWorkspace } from "@/hooks/use-workspace";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

import { ChatPanel } from "./chat-panel";
import { LeftPanel } from "./left-panel";
import { InspectorPanel } from "./inspector-panel";
import { WorkspaceFooter } from "./workspace-footer";
import { WorkspaceHeader } from "./workspace-header";

type WorkspaceShellProps = {
  slug: string;
  initialFilePath?: string | null;
};

type StoredLayoutState = {
  leftWidth?: number;
  rightWidth?: number;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
};

const MIN_LEFT_PX = 200;
const MIN_RIGHT_PX = 320;
const MIN_CENTER_PX = 360;
const DEFAULT_LEFT_RATIO = 0.15;
const DEFAULT_RIGHT_RATIO = 0.3;
const PANEL_GAP = 12; // Gap between floating panels in pixels

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

const getContainerWidth = (container: HTMLDivElement | null) => {
  if (container) {
    return container.getBoundingClientRect().width;
  }
  if (typeof window !== "undefined") {
    return window.innerWidth;
  }
  return MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX;
};

const loadStoredLayout = (key: string): StoredLayoutState | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLayoutState;
  } catch {
    return null;
  }
};

const persistLayout = (key: string, state: StoredLayoutState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
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

// File content cache for preview panel
type FileContentCache = Record<string, { content: string; type: 'raw' | 'patch'; title: string; updatedAt: string; size: string }>;

export function WorkspaceShell({ slug, initialFilePath }: WorkspaceShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutStorageKey = `arche.workspace.${slug}.layout`;
  
  // Instance startup state
  const [instanceStatus, setInstanceStatus] = useState<'starting' | 'running' | 'error' | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  // Auto-start instance on mount
  useEffect(() => {
    let cancelled = false;
    
    async function ensureRunning() {
      const result = await ensureInstanceRunningAction(slug);
      if (cancelled) return;
      
      if (result.status === 'error') {
        setInstanceStatus('error');
        setInstanceError(result.error ?? 'Unknown error');
        return;
      }
      
      setInstanceStatus(result.status);
      
      if (result.status === 'starting') {
        const poll = setInterval(async () => {
          const check = await ensureInstanceRunningAction(slug);
          if (cancelled) {
            clearInterval(poll);
            return;
          }
          if (check.status === 'running') {
            setInstanceStatus('running');
            clearInterval(poll);
          } else if (check.status === 'error') {
            setInstanceStatus('error');
            setInstanceError(check.error ?? 'Unknown error');
            clearInterval(poll);
          }
        }, 2000);
      }
    }
    
    ensureRunning();
    return () => { cancelled = true; };
  }, [slug]);

  // Use workspace hook only when instance is running
  const workspace = useWorkspace({ slug, pollInterval: 5000, enabled: instanceStatus === 'running' });

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
    }));
  }, [activeRootSessionId, sessionsById, workspace.sessions]);

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
      workspace.refreshDiffs();
      workspace.refreshFiles();
    })();
  }, [workspace, workspace.isConnected, slug, workspace.refreshDiffs, workspace.refreshFiles]);

  // Layout state
  const [leftWidth, setLeftWidth] = useState(MIN_LEFT_PX);
  const [rightWidth, setRightWidth] = useState(MIN_RIGHT_PX);
  const [minCenterWidth, setMinCenterWidth] = useState(MIN_CENTER_PX);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "review">("preview");
  const [hasHydrated, setHasHydrated] = useState(false);

  // File viewing state
  const [openFilePaths, setOpenFilePaths] = useState<string[]>(
    initialFilePath ? [initialFilePath] : []
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    initialFilePath ?? null
  );
  const [fileCache, setFileCache] = useState<FileContentCache>({});

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
          size: `${(result.content.length / 1024).toFixed(1)} KB`
        };
      });

      return changed ? next : prev;
    });
  }, [openFilePaths, workspace]);

  const handleSyncComplete = useCallback((status: SyncKbResult["status"]) => {
    workspace.refreshDiffs();
    workspace.refreshFiles();

    if (status === "synced") {
      void refreshOpenFilesCache();
    }
  }, [refreshOpenFilesCache, workspace]);

  const handlePublishComplete = useCallback(() => {
    workspace.refreshDiffs();
    workspace.refreshFiles();
  }, [workspace]);

  const handleResolveConflict = useCallback(
    (path: string, content: string) => {
      workspace.refreshDiffs();
      workspace.refreshFiles();

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
          },
        };
      });
    },
    [workspace]
  );

  const flattenedFilePaths = useMemo(() => {
    const paths: string[] = [];
    const visit = (nodes: WorkspaceFileNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "file") paths.push(node.path);
        if (node.children && node.children.length > 0) visit(node.children);
      });
    };
    visit(workspace.fileTree);
    return paths;
  }, [workspace.fileTree]);

  const filePathSet = useMemo(() => new Set(flattenedFilePaths), [flattenedFilePaths]);

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
      .map(diff => `${diff.path}:${diff.status}:${diff.additions}:${diff.deletions}`)
      .sort()
      .join('|');
  }, [workspace.diffs]);

  const lastDiffSignatureRef = useRef<string>('');

  useEffect(() => {
    if (!workspace.isConnected) return;
    if (!diffSignature) return;
    if (lastDiffSignatureRef.current === diffSignature) return;

    lastDiffSignatureRef.current = diffSignature;
    workspace.refreshFiles();

    const diffPaths = new Set(workspace.diffs.map(diff => diff.path));
    const pathsToRefresh = openFilePaths.filter(path => diffPaths.has(path));
    if (pathsToRefresh.length === 0) return;

    pathsToRefresh.forEach(async (path) => {
      const result = await workspace.readFile(path);
      if (!result) return;
      setFileCache(prev => ({
        ...prev,
        [path]: {
          content: result.content,
          type: result.type,
          title: path.split('/').pop() ?? path,
          updatedAt: 'Just now',
          size: `${(result.content.length / 1024).toFixed(1)} KB`
        }
      }));
    });
  }, [diffSignature, openFilePaths, workspace, workspace.diffs, workspace.isConnected, workspace.readFile, workspace.refreshFiles]);

  // Load layout from localStorage
  useEffect(() => {
    const stored = loadStoredLayout(layoutStorageKey);
    const containerWidth = getContainerWidth(containerRef.current);
    let leftCandidate = containerWidth * DEFAULT_LEFT_RATIO;
    let rightCandidate = containerWidth * DEFAULT_RIGHT_RATIO;

    if (stored?.leftWidth) leftCandidate = stored.leftWidth;
    if (stored?.rightWidth) rightCandidate = stored.rightWidth;

    const fitted = fitWidths(containerWidth, leftCandidate, rightCandidate);
    setLeftWidth(fitted.left);
    setRightWidth(fitted.right);
    setMinCenterWidth(fitted.minCenter);

    if (typeof stored?.leftCollapsed === "boolean") setLeftCollapsed(stored.leftCollapsed);
    if (typeof stored?.rightCollapsed === "boolean") setRightCollapsed(stored.rightCollapsed);
    
    setHasHydrated(true);
  }, [layoutStorageKey]);

  // Persist layout
  useEffect(() => {
    if (!hasHydrated) return;
    persistLayout(layoutStorageKey, {
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed
    });
  }, [layoutStorageKey, leftWidth, rightWidth, leftCollapsed, rightCollapsed, hasHydrated]);

  // Map workspace sessions to UI format
  const uiSessions = useMemo(() => {
    return workspace.sessions.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status === 'busy' ? 'active' as const : s.status === 'idle' ? 'idle' as const : 'archived' as const,
      updatedAt: s.updatedAt,
      agent: 'OpenCode'
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
          label: (p as { path: string }).path?.split('/').pop() ?? '',
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
          kind: path.endsWith('.md') ? 'markdown' as const : 'text' as const
        };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
  }, [openFilePaths, fileCache]);

  // File handlers
  const handleOpenFile = useCallback(async (path: string) => {
    const resolvedPath = resolveFilePath(path);
    const pathToOpen = resolvedPath || path;

    // Add to open files if not already open
    setOpenFilePaths(prev => prev.includes(pathToOpen) ? prev : [...prev, pathToOpen]);
    setActiveFilePath(pathToOpen);
    setRightTab("preview");
    setRightCollapsed(false);

    // Load file content if not cached
    if (!fileCache[pathToOpen]) {
      const result = await workspace.readFile(pathToOpen);
      if (result) {
        setFileCache(prev => ({
          ...prev,
          [pathToOpen]: {
            content: result.content,
            type: result.type,
            title: pathToOpen.split('/').pop() ?? pathToOpen,
            updatedAt: 'Just now',
            size: `${(result.content.length / 1024).toFixed(1)} KB`
          }
        }));
      } else {
        setFileCache(prev => ({
          ...prev,
          [pathToOpen]: {
            content: 'Unable to load file.',
            type: 'raw',
            title: pathToOpen.split('/').pop() ?? pathToOpen,
            updatedAt: 'Error',
            size: '0 KB'
          }
        }));
      }
    }
  }, [fileCache, resolveFilePath, workspace]);

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
    workspace.selectSession(sessionId);
  }, [workspace]);

  const handleSelectSessionTab = useCallback((sessionId: string) => {
    workspace.selectSession(sessionId);
  }, [workspace]);

  const handleCreateSession = useCallback(async () => {
    await workspace.createSession(`Session ${rootSessions.length + 1}`);
  }, [rootSessions.length, workspace]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    await workspace.deleteSession(sessionId);
  }, [workspace]);

  // Agent mention insertion
  const [pendingInsert, setPendingInsert] = useState<string | null>(null);

  const handleSelectAgent = useCallback((agent: { displayName: string }) => {
    setPendingInsert("@" + agent.displayName + " ");
  }, []);

  const handlePendingInsertConsumed = useCallback(() => {
    setPendingInsert(null);
  }, []);

  const handleToggleRight = useCallback(() => {
    setRightCollapsed((prev) => !prev);
  }, []);

  const handleOpenReview = useCallback(() => {
    setRightCollapsed(false);
    setRightTab("review");
  }, []);

  // Resize handlers - now work via the gap area between panels
  const handleResizeLeft = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;

    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveRight = rightCollapsed ? 0 : rightWidth + PANEL_GAP;
      const maxLeft = Math.max(MIN_LEFT_PX, rect.width - effectiveRight - minCenter - PANEL_GAP);
      const nextWidth = clamp(moveEvent.clientX - rect.left, MIN_LEFT_PX, maxLeft);
      setLeftWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
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

    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveLeft = leftCollapsed ? 0 : leftWidth + PANEL_GAP;
      const maxRight = Math.max(MIN_RIGHT_PX, rect.width - effectiveLeft - minCenter - PANEL_GAP);
      const nextWidth = clamp(rect.right - moveEvent.clientX, MIN_RIGHT_PX, maxRight);
      setRightWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [leftCollapsed, leftWidth]);

  // Get theme from context
  const { theme } = useWorkspaceTheme();

  // Build dark mode classes based on theme variant
  const darkModeClasses = theme.isDark
    ? `dark ${theme.darkVariant === "ash" ? "dark-ash" : "dark-ember"}`
    : "";
  const themeClassName = `theme-${theme.id}`;

  // Loading screen while instance is starting
  if (instanceStatus !== 'running') {
    return (
      <div 
        className={cn(
          "flex h-screen flex-col overflow-hidden text-foreground",
          darkModeClasses,
          themeClassName
        )}
        style={{ 
          backgroundImage: theme.gradient,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          backgroundAttachment: 'fixed'
        }}
      >
        <div className="flex h-full flex-col p-3">
          <WorkspaceHeader
            slug={slug}
            status={instanceStatus === 'starting' ? 'provisioning' : 'offline'}
          />
          
          <div className="relative z-10 flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
              {instanceStatus === 'starting' && (
                <>
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
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
                    <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-destructive">
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
                  <div className="relative">
                    <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
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
    return (
      <div 
        className={cn(
          "flex h-screen flex-col overflow-hidden text-foreground",
          darkModeClasses,
          themeClassName
        )}
        style={{ 
          backgroundImage: theme.gradient,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          backgroundAttachment: 'fixed'
        }}
      >
        <div className="flex h-full flex-col p-3">
          <WorkspaceHeader slug={slug} status="provisioning" />
          
          <div className="relative z-10 flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="relative">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                  Connecting to OpenCode
                </h2>
                <p className="text-sm text-muted-foreground">
                  {workspace.connection.status === 'error' 
                    ? `Error: ${workspace.connection.error}`
                    : 'Establishing connection...'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "flex h-screen flex-col overflow-hidden text-foreground",
        darkModeClasses,
        themeClassName
      )}
      style={{ 
        backgroundImage: theme.gradient,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* Outer padding container */}
      <div className="flex h-full flex-col p-3 gap-3">
        {/* Floating header */}
        <WorkspaceHeader
          slug={slug}
          status="active"
          onSyncComplete={handleSyncComplete}
        />

        {/* Main panels area */}
        <div ref={containerRef} className="relative z-10 flex min-h-0 flex-1 gap-3">
          {/* Left panel - Sessions / Agents / Knowledge (floating) */}
          {!leftCollapsed && (
            <div
              className="glass-panel shrink-0 overflow-hidden rounded-2xl"
              style={{
                width: leftWidth,
                minWidth: MIN_LEFT_PX
              }}
            >
              <LeftPanel
                sessions={rootSessions}
                activeSessionId={activeRootSessionId}
                onSelectSession={handleSelectSession}
                onCreateSession={handleCreateSession}
                agents={workspace.agentCatalog}
                onSelectAgent={handleSelectAgent}
                fileNodes={workspace.fileTree}
                activeFilePath={activeFilePath}
                onSelectFile={handleOpenFile}
              />
            </div>
          )}

          {/* Invisible resize handle for left panel - positioned in the gap */}
          {!leftCollapsed && (
            <div
              className="absolute top-0 bottom-0 z-20 w-6 cursor-col-resize"
              style={{ left: leftWidth - 3 }}
              onPointerDown={handleResizeLeft}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize left panel"
            />
          )}

          {/* Center panel - Chat (floating) */}
          <div 
            className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl" 
            style={{ minWidth: minCenterWidth }}
          >
            <ChatPanel
              sessions={uiSessions}
              messages={uiMessages}
              activeSessionId={workspace.activeSessionId}
              sessionTabs={activeSessionTabs}
              openFilesCount={openFilePaths.length}
              onCloseSession={handleCloseSession}
              onSelectSessionTab={handleSelectSessionTab}
              onOpenFile={handleOpenFile}
              onShowContext={() => {
                setRightCollapsed(false);
                setRightTab("preview");
              }}
              onSendMessage={workspace.sendMessage}
              isSending={workspace.isSending}
              models={workspace.models}
              selectedModel={workspace.selectedModel}
              onSelectModel={workspace.setSelectedModel}
              activeAgentName={workspace.activeAgentName}
              pendingInsert={pendingInsert}
              onPendingInsertConsumed={handlePendingInsertConsumed}
            />
          </div>

          {/* Invisible resize handle for right panel - positioned in the gap */}
          {!rightCollapsed && (
            <div
              className="absolute top-0 bottom-0 z-20 w-6 cursor-col-resize"
              style={{ right: rightWidth - 3 }}
              onPointerDown={handleResizeRight}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right panel"
            />
          )}

          {/* Right panel - Inspector (floating) */}
          {!rightCollapsed && (
            <div
              className="glass-panel shrink-0 overflow-hidden rounded-2xl"
              style={{
                width: rightWidth,
                minWidth: MIN_RIGHT_PX
              }}
            >
              <InspectorPanel
                slug={slug}
                activeTab={rightTab}
                onTabChange={setRightTab}
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                onSelectFile={handleSelectFile}
                onCloseFile={handleCloseFile}
                diffs={workspace.diffs}
                isLoadingDiffs={workspace.isLoadingDiffs}
                diffsError={workspace.diffsError}
                onOpenFile={handleOpenFile}
                onPublish={handlePublishComplete}
                onResolveConflict={handleResolveConflict}
              />
            </div>
          )}
        </div>

        {/* Floating footer */}
        <WorkspaceFooter
          slug={slug}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onToggleLeft={() => setLeftCollapsed(prev => !prev)}
          onToggleRight={handleToggleRight}
          onOpenReview={handleOpenReview}
          pendingDiffs={workspace.diffs.length}
        />
      </div>
    </div>
  );
}
