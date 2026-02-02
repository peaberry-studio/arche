"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureInstanceRunningAction } from "@/actions/spawner";
import { useWorkspace } from "@/hooks/use-workspace";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

import { ChatPanel } from "./chat-panel";
import { FileTreePanel } from "./file-tree-panel";
import { InspectorPanel } from "./inspector-panel";
import { PanelResizeHandle } from "./panel-resize-handle";
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getMinCenter = (containerWidth: number) =>
  Math.min(MIN_CENTER_PX, Math.max(0, containerWidth - MIN_LEFT_PX - MIN_RIGHT_PX));

const fitWidths = (containerWidth: number, leftWidth: number, rightWidth: number) => {
  const minCenter = getMinCenter(containerWidth);
  const maxLeft = Math.max(MIN_LEFT_PX, containerWidth - MIN_RIGHT_PX - minCenter);
  const maxRight = Math.max(MIN_RIGHT_PX, containerWidth - MIN_LEFT_PX - minCenter);

  let nextLeft = clamp(leftWidth, MIN_LEFT_PX, maxLeft);
  let nextRight = clamp(rightWidth, MIN_RIGHT_PX, maxRight);

  const total = nextLeft + nextRight + minCenter;
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

  const activeFile = useMemo(() => {
    return openFiles.find(f => f.path === activeFilePath) ?? null;
  }, [openFiles, activeFilePath]);

  // File handlers
  const handleOpenFile = useCallback(async (path: string) => {
    // Add to open files if not already open
    setOpenFilePaths(prev => prev.includes(path) ? prev : [...prev, path]);
    setActiveFilePath(path);
    setRightTab("preview");
    setRightCollapsed(false);

    // Load file content if not cached
    if (!fileCache[path]) {
      const result = await workspace.readFile(path);
      if (result) {
        setFileCache(prev => ({
          ...prev,
          [path]: {
            content: result.content,
            type: result.type,
            title: path.split('/').pop() ?? path,
            updatedAt: 'Ahora',
            size: `${(result.content.length / 1024).toFixed(1)} KB`
          }
        }));
      }
    }
  }, [fileCache, workspace]);

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

  const handleCreateSession = useCallback(async () => {
    await workspace.createSession(`Sesión ${workspace.sessions.length + 1}`);
  }, [workspace]);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    await workspace.deleteSession(sessionId);
  }, [workspace]);

  const handleRenameSession = useCallback(async (sessionId: string, newTitle: string) => {
    await workspace.renameSession(sessionId, newTitle);
  }, [workspace]);

  // Resize handlers
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
      const effectiveRight = rightCollapsed ? 0 : rightWidth;
      const maxLeft = Math.max(MIN_LEFT_PX, rect.width - effectiveRight - minCenter);
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
      const effectiveLeft = leftCollapsed ? 0 : leftWidth;
      const maxRight = Math.max(MIN_RIGHT_PX, rect.width - effectiveLeft - minCenter);
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

  // Loading screen while instance is starting
  if (instanceStatus !== 'running') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 organic-background" />
        
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
                    Iniciando workspace
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Preparando tu entorno de desarrollo...
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
                    Error al iniciar
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {instanceError ?? 'No se pudo iniciar el workspace'}
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
                    Conectando...
                  </h2>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connecting to OpenCode screen
  if (!workspace.isConnected) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 organic-background" />
        
        <WorkspaceHeader slug={slug} status="provisioning" />
        
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="relative">
              <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                Conectando con OpenCode
              </h2>
              <p className="text-sm text-muted-foreground">
                {workspace.connection.status === 'error' 
                  ? `Error: ${workspace.connection.error}`
                  : 'Estableciendo conexión...'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <WorkspaceHeader slug={slug} status="active" />

      <div ref={containerRef} className="relative z-10 flex min-h-0 flex-1">
        {/* Left panel - File tree */}
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: leftCollapsed ? 0 : leftWidth,
            minWidth: leftCollapsed ? 0 : MIN_LEFT_PX
          }}
        >
          {!leftCollapsed && (
            <FileTreePanel
              nodes={workspace.fileTree}
              activePath={activeFilePath}
              onSelect={handleOpenFile}
            />
          )}
        </div>

        <PanelResizeHandle
          position="left"
          onPointerDown={handleResizeLeft}
          hidden={leftCollapsed}
        />

        {/* Center panel - Chat */}
        <div className="flex min-w-0 flex-1 flex-col" style={{ minWidth: minCenterWidth }}>
          <ChatPanel
            sessions={uiSessions}
            messages={uiMessages}
            activeSessionId={workspace.activeSessionId ?? ''}
            openFilesCount={openFilePaths.length}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onCloseSession={handleCloseSession}
            onRenameSession={handleRenameSession}
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
          />
        </div>

        <PanelResizeHandle
          position="right"
          onPointerDown={handleResizeRight}
          hidden={rightCollapsed}
        />

        {/* Right panel - Inspector */}
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: rightCollapsed ? 0 : rightWidth,
            minWidth: rightCollapsed ? 0 : MIN_RIGHT_PX
          }}
        >
          {!rightCollapsed && (
            <InspectorPanel
              activeTab={rightTab}
              onTabChange={setRightTab}
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              onSelectFile={handleSelectFile}
              onCloseFile={handleCloseFile}
              diffs={workspace.diffs}
              onOpenFile={handleOpenFile}
            />
          )}
        </div>
      </div>

      <WorkspaceFooter
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={() => setLeftCollapsed(prev => !prev)}
        onToggleRight={() => setRightCollapsed(prev => !prev)}
      />
    </div>
  );
}
