"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ensureInstanceRunningAction } from "@/actions/spawner";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useWorkspace } from "@/hooks/use-workspace";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import {
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";
import { takeWorkspaceStartPrompt } from "@/lib/workspace-start-prompt";
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
  rightTab?: "preview" | "review";
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
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
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

const PANEL_ANIM = "200ms ease-out";
const PANEL_TRANSITION = `width ${PANEL_ANIM}, min-width ${PANEL_ANIM}, opacity ${PANEL_ANIM}, margin ${PANEL_ANIM}, border-width ${PANEL_ANIM}`;

export function WorkspaceShell({ slug, initialFilePath }: WorkspaceShellProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
        if (result.error === 'setup_required') {
          router.replace(`/u/${slug}?setup=required`);
          return;
        }
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
            if (check.error === 'setup_required') {
              clearInterval(poll);
              router.replace(`/u/${slug}?setup=required`);
              return;
            }
            setInstanceStatus('error');
            setInstanceError(check.error ?? 'Unknown error');
            clearInterval(poll);
          }
        }, 2000);
      }
    }
    
    ensureRunning();
    return () => { cancelled = true; };
  }, [router, slug]);

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
      workspace.refreshDiffs();
      workspace.refreshFiles();
    })();
  }, [workspace, workspace.isConnected, slug, workspace.refreshDiffs, workspace.refreshFiles]);

  useEffect(() => {
    if (!workspace.isConnected || hasAutoStartedPrompt.current) return;

    let prompt: string | null = null;
    try {
      prompt = takeWorkspaceStartPrompt(window.sessionStorage, slug);
    } catch {
      prompt = null;
    }

    hasAutoStartedPrompt.current = true;
    if (!prompt) return;

    void workspace.sendMessage(prompt, undefined, { forceNewSession: true });
  }, [workspace, workspace.isConnected, slug]);

  // Layout state
  const [leftWidth, setLeftWidth] = useState(MIN_LEFT_PX);
  const [rightWidth, setRightWidth] = useState(MIN_RIGHT_PX);
  const [minCenterWidth, setMinCenterWidth] = useState(MIN_CENTER_PX);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "review">("preview");
  const [hydratedLayoutKey, setHydratedLayoutKey] = useState<string | null>(null);

  const focusSearchInput = useCallback(() => {
    if (leftCollapsed) setLeftCollapsed(false);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [leftCollapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;

      event.preventDefault();
      focusSearchInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusSearchInput]);

  // File viewing state
  const safeInitialFilePath = useMemo(() => {
    if (!initialFilePath) return null;
    const normalized = normalizeWorkspacePath(initialFilePath);
    if (!normalized || isProtectedWorkspacePath(normalized)) return null;
    return normalized;
  }, [initialFilePath]);

  const [openFilePaths, setOpenFilePaths] = useState<string[]>(
    safeInitialFilePath ? [safeInitialFilePath] : []
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    safeInitialFilePath
  );
  const [fileCache, setFileCache] = useState<FileContentCache>({});
  const fileCacheRef = useRef(fileCache);

  useEffect(() => {
    fileCacheRef.current = fileCache;
  }, [fileCache]);

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

      workspace.refreshDiffs();
      workspace.refreshFiles();

      return { ok: true as const, hash: result.hash };
    },
    [workspace]
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

      workspace.refreshDiffs();
      workspace.refreshFiles();

      return { ok: true as const };
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
    if (stored?.rightTab === "preview" || stored?.rightTab === "review") setRightTab(stored.rightTab);

    setHydratedLayoutKey(layoutStorageKey);
  }, [layoutStorageKey]);

  // Persist layout
  useEffect(() => {
    if (hydratedLayoutKey !== layoutStorageKey) return;
    persistLayout(layoutStorageKey, {
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed,
      rightTab,
    });
  }, [layoutStorageKey, leftWidth, rightWidth, leftCollapsed, rightCollapsed, rightTab, hydratedLayoutKey]);

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

  const handleOpenExpertsSettings = useCallback(() => {
    router.push(`/u/${slug}/agents`);
  }, [router, slug]);

  const handleCreateKnowledgeFile = useCallback(
    async (path: string) => {
      const normalizedPath = normalizePath(path).replace(/^\/+/, "");
      if (!normalizedPath) {
        return { ok: false as const, error: "invalid_path" };
      }

      if (filePathSet.has(normalizedPath)) {
        return { ok: false as const, error: "file_exists" };
      }

      if (openFilePaths.includes(normalizedPath) || Boolean(fileCacheRef.current[normalizedPath])) {
        return { ok: false as const, error: "file_exists" };
      }

      const result = await workspace.writeFile(normalizedPath, "");
      if (!result.ok) {
        return {
          ok: false as const,
          error: result.error ?? "create_failed",
        };
      }

      setFileCache((prev) => ({
        ...prev,
        [normalizedPath]: {
          content: "",
          type: "raw",
          title: normalizedPath.split("/").pop() ?? normalizedPath,
          updatedAt: "Just now",
          size: "0.0 KB",
          hash: result.hash,
        },
      }));

      setOpenFilePaths((prev) =>
        prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]
      );
      setActiveFilePath(normalizedPath);
      setRightTab("preview");
      setRightCollapsed(false);

      workspace.refreshFiles();
      workspace.refreshDiffs();

      return { ok: true as const };
    },
    [filePathSet, normalizePath, openFilePaths, workspace]
  );

  // File handlers
  const handleOpenFile = useCallback(async (path: string) => {
    const resolvedPath = resolveFilePath(path);
    const pathToOpen = resolvedPath || path;
    const normalizedPath = normalizeWorkspacePath(pathToOpen);

    if (!normalizedPath || isProtectedWorkspacePath(normalizedPath)) {
      return;
    }

    // Add to open files if not already open
    setOpenFilePaths(prev => prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]);
    setActiveFilePath(normalizedPath);
    setRightTab("preview");
    setRightCollapsed(false);

    // Load file content if not cached
    if (!fileCacheRef.current[normalizedPath]) {
      const result = await workspace.readFile(normalizedPath);
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
    }, [resolveFilePath, workspace]);

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

    setIsDragging(true);
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
      const effectiveLeft = leftCollapsed ? 0 : leftWidth + PANEL_GAP;
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

  // Get theme from context
  const { theme } = useWorkspaceTheme();

  // Build dark mode classes based on theme variant
  const darkModeClasses = theme.isDark
    ? `dark dark-${theme.darkVariant}`
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
          <WorkspaceHeader
            slug={slug}
            status="provisioning"
          />
          
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
          {/* Left panel - Sessions / Experts / Knowledge (floating) */}
          <div
            className="shrink-0 overflow-hidden"
            style={{
              width: leftCollapsed ? 0 : leftWidth,
              minWidth: leftCollapsed ? 0 : MIN_LEFT_PX,
              opacity: leftCollapsed ? 0 : 1,
              marginRight: leftCollapsed ? -PANEL_GAP : 0,
              transition: isDragging ? "none" : PANEL_TRANSITION,
            }}
            aria-hidden={leftCollapsed}
          >
            <LeftPanel
              key={slug}
              slug={slug}
              sessions={rootSessions}
              activeSessionId={activeRootSessionId}
              onSelectSession={handleSelectSession}
              onCreateSession={handleCreateSession}
              agents={workspace.agentCatalog}
              onSelectAgent={handleSelectAgent}
              onOpenExpertsSettings={handleOpenExpertsSettings}
              fileNodes={workspace.fileTree}
              activeFilePath={activeFilePath}
              onSelectFile={handleOpenFile}
              onCreateKnowledgeFile={handleCreateKnowledgeFile}
              searchInputRef={searchInputRef}
            />
          </div>

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
              slug={slug}
              sessions={uiSessions}
              messages={uiMessages}
              activeSessionId={workspace.activeSessionId}
              isStartingNewSession={workspace.isStartingNewSession}
              sessionTabs={activeSessionTabs}
              openFilePaths={openFilePaths}
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
          <div
            className="glass-panel shrink-0 overflow-hidden rounded-2xl"
            style={{
              width: rightCollapsed ? 0 : rightWidth,
              minWidth: rightCollapsed ? 0 : MIN_RIGHT_PX,
              opacity: rightCollapsed ? 0 : 1,
              marginLeft: rightCollapsed ? -PANEL_GAP : 0,
              borderWidth: rightCollapsed ? 0 : undefined,
              transition: isDragging ? "none" : PANEL_TRANSITION,
            }}
            aria-hidden={rightCollapsed}
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
              onReloadFile={handleReloadFile}
              onSaveFile={handleSaveFile}
              onDiscardFileChanges={handleDiscardFileChanges}
              onPublish={handlePublishComplete}
              onResolveConflict={handleResolveConflict}
            />
          </div>
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
