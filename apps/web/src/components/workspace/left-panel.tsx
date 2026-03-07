"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChatCircle,
  Database,
  MagnifyingGlass,
  Plus,
  Robot,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import type { AgentCatalogItem } from "@/hooks/use-workspace";

import { AgentsPanel } from "./agents-panel";
import { FileTreePanel } from "./file-tree-panel";
import { SessionsPanel } from "./sessions-panel";

const MIN_SECTION_PX = 60;
const SECTION_GAP = 12; // matches gap-3 between main panels
const HEADER_HEIGHT = 32; // h-8
const ANIM = "200ms ease-out";
const FLEX_TRANSITION = `flex-grow ${ANIM}, flex-basis ${ANIM}`;
const GRID_TRANSITION = `grid-template-rows ${ANIM}`;

const DEFAULT_TOP_RATIO = 3 / 8;
const DEFAULT_MID_RATIO = 3 / 8;

type StoredLeftPanelState = {
  topRatio?: number;
  midRatio?: number;
  topCollapsed?: boolean;
  midCollapsed?: boolean;
  bottomCollapsed?: boolean;
};

type NormalizedLeftPanelState = {
  topRatio: number;
  midRatio: number;
  topCollapsed: boolean;
  midCollapsed: boolean;
  bottomCollapsed: boolean;
};

const DEFAULT_LEFT_PANEL_STATE: NormalizedLeftPanelState = {
  topRatio: DEFAULT_TOP_RATIO,
  midRatio: DEFAULT_MID_RATIO,
  topCollapsed: false,
  midCollapsed: false,
  bottomCollapsed: false,
};

function isValidRatio(value: unknown): value is number {
  return typeof value === "number" && isFinite(value) && value > 0 && value < 1;
}

function loadStoredLeftPanelState(key: string): StoredLeftPanelState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLeftPanelState;
  } catch {
    return null;
  }
}

function persistLeftPanelState(key: string, state: NormalizedLeftPanelState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function getInitialLeftPanelState(key: string): NormalizedLeftPanelState {
  const stored = loadStoredLeftPanelState(key);
  if (!stored) return DEFAULT_LEFT_PANEL_STATE;

  return {
    topRatio: isValidRatio(stored.topRatio) ? stored.topRatio : DEFAULT_TOP_RATIO,
    midRatio: isValidRatio(stored.midRatio) ? stored.midRatio : DEFAULT_MID_RATIO,
    topCollapsed: typeof stored.topCollapsed === "boolean" ? stored.topCollapsed : false,
    midCollapsed: typeof stored.midCollapsed === "boolean" ? stored.midCollapsed : false,
    bottomCollapsed: typeof stored.bottomCollapsed === "boolean" ? stored.bottomCollapsed : false,
  };
}

type LeftPanelProps = {
  slug: string;

  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;

  // Agents
  agents: AgentCatalogItem[];
  onSelectAgent: (agent: AgentCatalogItem) => void;
  onOpenExpertsSettings: () => void;

  // Knowledge (file tree)
  fileNodes: WorkspaceFileNode[];
  activeFilePath?: string | null;
  onSelectFile: (path: string) => void;
  onCreateKnowledgeFile: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  searchInputRef: RefObject<HTMLInputElement | null>;
};

type DirectoryOption = {
  path: string;
  label: string;
};

function collectDirectoryOptions(nodes: WorkspaceFileNode[], depth = 0): DirectoryOption[] {
  const directories = nodes
    .filter((node) => node.type === "directory")
    .sort((a, b) => a.name.localeCompare(b.name));

  const options: DirectoryOption[] = [];

  directories.forEach((directory) => {
    options.push({
      path: directory.path,
      label: `${depth > 0 ? `${"-- ".repeat(depth)}` : ""}${directory.name}`,
    });

    if (directory.children && directory.children.length > 0) {
      options.push(...collectDirectoryOptions(directory.children, depth + 1));
    }
  });

  return options;
}

function SectionHeader({
  icon: Icon,
  label,
  onToggle,
  onAction,
  actionIcon: ActionIcon,
  actionLabel,
}: {
  icon: typeof ChatCircle;
  label: string;
  onToggle: () => void;
  onAction?: () => void;
  actionIcon?: typeof Plus;
  actionLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 w-full shrink-0 items-center gap-1.5 px-3 transition-colors hover:bg-foreground/5"
    >
      <Icon size={14} weight="bold" className="text-muted-foreground" />
      <span className="flex-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {onAction && ActionIcon && (
        <span
          role="button"
          tabIndex={0}
          aria-label={actionLabel}
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onAction(); } }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <ActionIcon size={14} weight="bold" />
        </span>
      )}
    </button>
  );
}

export function LeftPanel({
  slug,
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  agents,
  onSelectAgent,
  onOpenExpertsSettings,
  fileNodes,
  activeFilePath,
  onSelectFile,
  onCreateKnowledgeFile,
  searchInputRef,
}: LeftPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const newFileNameRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateFileDialogOpen, setIsCreateFileDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState("");
  const [createFileError, setCreateFileError] = useState<string | null>(null);
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const leftPanelStorageKey = useMemo(() => `arche.workspace.${slug}.left-panel`, [slug]);
  const initialPanelState = useMemo(() => getInitialLeftPanelState(leftPanelStorageKey), [leftPanelStorageKey]);

  const [topRatio, setTopRatio] = useState(initialPanelState.topRatio);
  const [midRatio, setMidRatio] = useState(initialPanelState.midRatio);

  const [topCollapsed, setTopCollapsed] = useState(initialPanelState.topCollapsed);
  const [midCollapsed, setMidCollapsed] = useState(initialPanelState.midCollapsed);
  const [bottomCollapsed, setBottomCollapsed] = useState(initialPanelState.bottomCollapsed);

  const directoryOptions = useMemo(
    () => collectDirectoryOptions(fileNodes),
    [fileNodes]
  );

  useEffect(() => {
    persistLeftPanelState(leftPanelStorageKey, { topRatio, midRatio, topCollapsed, midCollapsed, bottomCollapsed });
  }, [leftPanelStorageKey, topRatio, midRatio, topCollapsed, midCollapsed, bottomCollapsed]);

  useEffect(() => {
    if (!isCreateFileDialogOpen) return;

    const frame = requestAnimationFrame(() => {
      newFileNameRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [isCreateFileDialogOpen]);

  const resetCreateFileDialog = useCallback(() => {
    setNewFileName("");
    setSelectedDirectoryPath("");
    setCreateFileError(null);
    setIsCreatingFile(false);
  }, []);

  const handleCreateFileDialogChange = useCallback(
    (open: boolean) => {
      setIsCreateFileDialogOpen(open);
      if (!open) {
        resetCreateFileDialog();
      }
    },
    [resetCreateFileDialog]
  );

  const handleOpenCreateFileDialog = useCallback(() => {
    resetCreateFileDialog();
    setIsCreateFileDialogOpen(true);
  }, [resetCreateFileDialog]);

  const handleCreateKnowledgeFile = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isCreatingFile) return;

      const trimmedName = newFileName.trim();
      const baseName = trimmedName.replace(/\.md$/i, "");
      if (!baseName) {
        setCreateFileError("File name is required.");
        return;
      }

      if (/[\\/]/.test(baseName)) {
        setCreateFileError("File name cannot contain slashes.");
        return;
      }

      const directory = selectedDirectoryPath.replace(/\/+$/, "");
      const filePath = directory ? `${directory}/${baseName}.md` : `${baseName}.md`;

      setIsCreatingFile(true);
      setCreateFileError(null);

      const result = await onCreateKnowledgeFile(filePath);
      if (!result.ok) {
        setCreateFileError(
          result.error === "file_exists"
            ? "A file with that name already exists in that location."
            : "Unable to create the file. Please try again."
        );
        setIsCreatingFile(false);
        return;
      }

      setIsCreatingFile(false);
      setIsCreateFileDialogOpen(false);
      resetCreateFileDialog();
    },
    [isCreatingFile, newFileName, onCreateKnowledgeFile, resetCreateFileDialog, selectedDirectoryPath]
  );

  // Effective ratios — redistribute space proportionally among expanded sections
  const baseBot = 1 - topRatio - midRatio;
  const expandedSum =
    (topCollapsed ? 0 : topRatio) +
    (midCollapsed ? 0 : midRatio) +
    (bottomCollapsed ? 0 : baseBot);

  const effectiveTop = expandedSum > 0 ? topRatio / expandedSum : 1;
  const effectiveMid = expandedSum > 0 ? midRatio / expandedSum : 1;
  const effectiveBot = expandedSum > 0 ? baseBot / expandedSum : 1;

  const handleResizeTop = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startTopRatio = topRatio;
      const startMidRatio = midRatio;

      setIsDragging(true);
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const deltaRatio = deltaY / containerHeight;
        const minRatio = MIN_SECTION_PX / containerHeight;

        let newTop = startTopRatio + deltaRatio;
        let newMid = startMidRatio - deltaRatio;
        const bottomRatio = 1 - newTop - newMid;

        if (newTop < minRatio) {
          newMid = newMid - (minRatio - newTop);
          newTop = minRatio;
        }
        if (newMid < minRatio) {
          newTop = newTop - (minRatio - newMid);
          newMid = minRatio;
        }
        if (newTop < minRatio) newTop = minRatio;
        if (bottomRatio < minRatio) return;

        setTopRatio(newTop);
        setMidRatio(newMid);
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
    },
    [topRatio, midRatio]
  );

  const handleResizeMid = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startMidRatio = midRatio;

      setIsDragging(true);
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const deltaRatio = deltaY / containerHeight;
        const minRatio = MIN_SECTION_PX / containerHeight;

        let newMid = startMidRatio + deltaRatio;
        const bottomRatio = 1 - topRatio - newMid;

        if (newMid < minRatio) newMid = minRatio;
        if (bottomRatio < minRatio) {
          newMid = 1 - topRatio - minRatio;
        }

        setMidRatio(newMid);
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
    },
    [topRatio, midRatio]
  );

  const sectionStyle = (collapsed: boolean, ratio: number): React.CSSProperties => ({
    flexGrow: collapsed ? 0 : ratio,
    flexShrink: collapsed ? 0 : 1,
    flexBasis: collapsed ? HEADER_HEIGHT : 0,
    transition: isDragging ? "none" : FLEX_TRANSITION,
  });

  const contentStyle = (collapsed: boolean): React.CSSProperties => ({
    display: "grid",
    gridTemplateRows: collapsed ? "0fr" : "1fr",
    transition: isDragging ? "none" : GRID_TRANSITION,
    minHeight: 0,
  });

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col text-card-foreground"
      style={{ gap: SECTION_GAP }}
    >
      {/* Search bar */}
      <label className="glass-panel flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 transition-colors hover:bg-foreground/5 focus-within:bg-foreground/5">
          <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search..."
            aria-label="Search chats, knowledge, and experts"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          {searchQuery.trim().length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X size={11} weight="bold" />
            </button>
          ) : (
            <span className="hidden shrink-0 rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/40 sm:inline-flex">
              &#8984;K
            </span>
          )}
      </label>

      {/* Section 1: Chats */}
      <div
        style={sectionStyle(topCollapsed, effectiveTop)}
        className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
      >
        <SectionHeader
          icon={ChatCircle}
          label="Chats"
          onToggle={() => setTopCollapsed(prev => !prev)}
          onAction={onCreateSession}
          actionIcon={Plus}
          actionLabel="New chat"
        />
        <div className="min-h-0 flex-1" style={contentStyle(topCollapsed)}>
          <div className="flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
            <SessionsPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={onSelectSession}
              onCreateSession={onCreateSession}
              query={searchQuery}
            />
          </div>
        </div>
      </div>

      {/* Resize handle 1 */}
      {!topCollapsed && !midCollapsed && (
        <div
          className="group relative h-0 w-full shrink-0 cursor-row-resize"
          onPointerDown={handleResizeTop}
          role="separator"
          aria-orientation="horizontal"
          style={{ marginTop: -SECTION_GAP / 2, marginBottom: -SECTION_GAP / 2 }}
        >
          <div className="absolute -top-1 -bottom-1 left-0 right-0" />
        </div>
      )}

      {/* Section 2: Knowledge */}
      <div
        style={sectionStyle(midCollapsed, effectiveMid)}
        className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
      >
        <SectionHeader
          icon={Database}
          label="Knowledge"
          onToggle={() => setMidCollapsed(prev => !prev)}
          onAction={handleOpenCreateFileDialog}
          actionIcon={Plus}
          actionLabel="Create file"
        />
        <div className="min-h-0 flex-1" style={contentStyle(midCollapsed)}>
          <div className="flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
            <FileTreePanel
              nodes={fileNodes}
              activePath={activeFilePath}
              onSelect={onSelectFile}
              hideHeader
              query={searchQuery}
            />
          </div>
        </div>
      </div>

      {/* Resize handle 2 */}
      {!midCollapsed && !bottomCollapsed && (
        <div
          className="group relative h-0 w-full shrink-0 cursor-row-resize"
          onPointerDown={handleResizeMid}
          role="separator"
          aria-orientation="horizontal"
          style={{ marginTop: -SECTION_GAP / 2, marginBottom: -SECTION_GAP / 2 }}
        >
          <div className="absolute -top-1 -bottom-1 left-0 right-0" />
        </div>
      )}

      {/* Section 3: Experts */}
      <div
        style={sectionStyle(bottomCollapsed, effectiveBot)}
        className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
      >
        <SectionHeader
          icon={Robot}
          label="Experts"
          onToggle={() => setBottomCollapsed(prev => !prev)}
          onAction={onOpenExpertsSettings}
          actionIcon={SlidersHorizontal}
          actionLabel="Edit experts"
        />
        <div className="min-h-0 flex-1" style={contentStyle(bottomCollapsed)}>
          <div className="flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
            <AgentsPanel agents={agents} onSelectAgent={onSelectAgent} query={searchQuery} />
          </div>
        </div>
      </div>

      <Dialog open={isCreateFileDialogOpen} onOpenChange={handleCreateFileDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create knowledge file</DialogTitle>
            <DialogDescription>
              Create a new Markdown file in your workspace knowledge tree.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleCreateKnowledgeFile}>
            <div className="space-y-2">
              <Label htmlFor="knowledge-file-name">File name</Label>
              <Input
                id="knowledge-file-name"
                ref={newFileNameRef}
                value={newFileName}
                onChange={(event) => {
                  setNewFileName(event.target.value);
                  if (createFileError) {
                    setCreateFileError(null);
                  }
                }}
                placeholder="meeting-notes"
                autoComplete="off"
                disabled={isCreatingFile}
              />
              <p className="text-[11px] text-muted-foreground">
                The file will be created as <span className="font-mono">&lt;name&gt;.md</span>.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="knowledge-file-directory">Location</Label>
              <select
                id="knowledge-file-directory"
                value={selectedDirectoryPath}
                onChange={(event) => setSelectedDirectoryPath(event.target.value)}
                disabled={isCreatingFile}
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <option value="">Root</option>
                {directoryOptions.map((option) => (
                  <option key={option.path} value={option.path}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {createFileError ? (
              <p className="text-xs text-destructive">{createFileError}</p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleCreateFileDialogChange(false)}
                disabled={isCreatingFile}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingFile}>
                {isCreatingFile ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
