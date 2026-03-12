"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowLineRight,
  ChatCircle,
  Circle,
  Cpu,
  Database,
  GearSix,
  MagnifyingGlass,
  Minus,
  Palette,
  Plugs,
  Plus,
  Robot,
  ArrowLineLeft,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import type { AgentCatalogItem } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

import { AgentsPanel } from "./agents-panel";
import { FileTreePanel } from "./file-tree-panel";
import { SessionsPanel } from "./sessions-panel";
import { SyncKbButton } from "./sync-kb-button";

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

// --- Connector / Provider types (moved from workspace-footer) ---

type ConnectorStatus = "ready" | "pending" | "disabled";
type ProviderStatus = "enabled" | "disabled" | "missing";

type ConnectorSummary = {
  id: string;
  name: string;
  type: string;
  status: ConnectorStatus;
};

type ProviderSummary = {
  providerId: string;
  status: ProviderStatus;
  type?: string;
  version?: number;
};

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false },
};

function connectorStatusInfo(status: ConnectorStatus): { label: string; dotClassName: string } {
  if (status === "ready") return { label: "Working", dotClassName: "bg-emerald-500" };
  if (status === "pending") return { label: "Pending", dotClassName: "bg-amber-500" };
  return { label: "Not working", dotClassName: "bg-rose-500" };
}

function providerLabel(providerId: string): string {
  if (providerId === "openai") return "OpenAI";
  if (providerId === "anthropic") return "Anthropic";
  if (providerId === "openrouter") return "OpenRouter";
  if (providerId === "opencode") return "OpenCode Zen";
  return providerId;
}

// --- Props ---

type LeftPanelProps = {
  slug: string;
  status: "active" | "provisioning" | "offline";
  leftCollapsed: boolean;
  onToggleLeft: () => void;
  onSyncComplete?: (status: SyncKbResult["status"]) => void;
  onNavigateDashboard: () => void;
  onNavigateSettings: () => void;

  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  unseenCompletedSessions: ReadonlySet<string>;
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

// --- Minified (collapsed) panel ---

function MinifiedLeftPanel({
  slug,
  status,
  onToggleLeft,
  onExpandWithSection,
  onSyncComplete,
  onNavigateSettings,
}: {
  slug: string;
  status: "active" | "provisioning" | "offline";
  onToggleLeft: () => void;
  onExpandWithSection: (section: "chats" | "knowledge" | "experts") => void;
  onSyncComplete?: (status: SyncKbResult["status"]) => void;
  onNavigateSettings: () => void;
}) {
  const {
    themes,
    themeId,
    setThemeId,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
  } = useWorkspaceTheme();

  const { lightThemes, darkThemes } = useMemo(() => ({
    lightThemes: themes.filter((t) => !t.isDark),
    darkThemes: themes.filter((t) => t.isDark),
  }), [themes]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full flex-col items-center py-2 text-card-foreground">
        {/* Toggle expand */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleLeft}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Expand panel"
            >
              <ArrowLineRight size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand panel</TooltipContent>
        </Tooltip>

        <div className="my-2 h-px w-6 bg-border/40" />

        {/* Section shortcuts — click expands panel and opens section */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onExpandWithSection("chats")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Chats"
            >
              <ChatCircle size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Chats</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onExpandWithSection("knowledge")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Knowledge"
            >
              <Database size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Knowledge</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onExpandWithSection("experts")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Experts"
            >
              <Robot size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Experts</TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons — execute without expanding */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <SyncKbButton
                slug={slug}
                disabled={status !== "active"}
                onComplete={onSyncComplete}
                variant="muted"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Sync KB</TooltipContent>
        </Tooltip>

        {/* Theme picker */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  aria-label="Theme"
                >
                  <Palette size={16} weight="bold" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Change theme</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" className="min-w-[220px]">
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Light</DropdownMenuLabel>
            {lightThemes.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => setThemeId(t.id)} className={cn("flex items-center gap-3", themeId === t.id && "bg-primary/10")}>
                <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                  <div className="w-1/2" style={{ backgroundColor: t.swatches[0] }} />
                  <div className="w-1/2" style={{ backgroundColor: t.swatches[1] }} />
                </div>
                <span className="text-sm">{t.name}</span>
                {themeId === t.id && <span className="ml-auto text-[10px] text-primary">Active</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Dark</DropdownMenuLabel>
            {darkThemes.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => setThemeId(t.id)} className={cn("flex items-center gap-3", themeId === t.id && "bg-primary/10")}>
                <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                  <div className="w-1/2" style={{ backgroundColor: t.swatches[0] }} />
                  <div className="w-1/2" style={{ backgroundColor: t.swatches[1] }} />
                </div>
                <span className="text-sm">{t.name}</span>
                {themeId === t.id && <span className="ml-auto text-[10px] text-primary">Active</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font style</span>
                <span className="text-xs font-medium text-foreground/80">{chatFontFamily === "sans" ? "Sans" : "Serif"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant={chatFontFamily === "sans" ? "secondary" : "outline"} className="h-8" onClick={() => setChatFontFamily("sans")}>Sans</Button>
                <Button type="button" size="sm" variant={chatFontFamily === "serif" ? "secondary" : "outline"} className="h-8" onClick={() => setChatFontFamily("serif")}>Serif</Button>
              </div>
            </div>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font size</span>
                <span className="text-xs font-medium tabular-nums text-foreground/80">{chatFontSize}px</span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={decreaseChatFontSize} disabled={!canDecreaseChatFontSize} aria-label="Decrease chat font size"><Minus size={14} weight="bold" /></Button>
                <div className="flex-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-center text-xs text-muted-foreground">Chat only</div>
                <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={increaseChatFontSize} disabled={!canIncreaseChatFontSize} aria-label="Increase chat font size"><Plus size={14} weight="bold" /></Button>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onNavigateSettings}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Settings"
            >
              <GearSix size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// --- Expanded panel ---

export function LeftPanel({
  slug,
  status,
  leftCollapsed,
  onToggleLeft,
  onSyncComplete,
  onNavigateDashboard,
  onNavigateSettings,
  sessions,
  activeSessionId,
  unseenCompletedSessions,
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
  const pendingSectionRef = useRef<"chats" | "knowledge" | "experts" | null>(null);

  const handleExpandWithSection = useCallback((section: "chats" | "knowledge" | "experts") => {
    pendingSectionRef.current = section;
    onToggleLeft();
  }, [onToggleLeft]);

  // --- Minified state ---
  if (leftCollapsed) {
    return (
      <MinifiedLeftPanel
        slug={slug}
        status={status}
        onToggleLeft={onToggleLeft}
        onExpandWithSection={handleExpandWithSection}
        onSyncComplete={onSyncComplete}
        onNavigateSettings={onNavigateSettings}
      />
    );
  }

  // --- Expanded state ---
  return (
    <ExpandedLeftPanel
      slug={slug}
      status={status}
      leftCollapsed={leftCollapsed}
      onToggleLeft={onToggleLeft}
      onSyncComplete={onSyncComplete}
      onNavigateDashboard={onNavigateDashboard}
      onNavigateSettings={onNavigateSettings}
      sessions={sessions}
      activeSessionId={activeSessionId}
      unseenCompletedSessions={unseenCompletedSessions}
      onSelectSession={onSelectSession}
      onCreateSession={onCreateSession}
      agents={agents}
      onSelectAgent={onSelectAgent}
      onOpenExpertsSettings={onOpenExpertsSettings}
      fileNodes={fileNodes}
      activeFilePath={activeFilePath}
      onSelectFile={onSelectFile}
      onCreateKnowledgeFile={onCreateKnowledgeFile}
      searchInputRef={searchInputRef}
      pendingSectionRef={pendingSectionRef}
    />
  );
}

function ExpandedLeftPanel({
  slug,
  status,
  onToggleLeft,
  onSyncComplete,
  onNavigateDashboard,
  onNavigateSettings,
  sessions,
  activeSessionId,
  unseenCompletedSessions,
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
  pendingSectionRef,
}: LeftPanelProps & { pendingSectionRef?: RefObject<"chats" | "knowledge" | "experts" | null> }) {
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

  // Expand the requested section when coming from a minified panel click
  useEffect(() => {
    const section = pendingSectionRef?.current;
    if (!section) return;
    pendingSectionRef.current = null;
    if (section === "chats") setTopCollapsed(false);
    else if (section === "knowledge") setMidCollapsed(false);
    else if (section === "experts") setBottomCollapsed(false);
  }); // intentionally no deps — runs every render but only acts when ref is set

  const directoryOptions = useMemo(
    () => collectDirectoryOptions(fileNodes),
    [fileNodes]
  );

  // Theme
  const {
    themes,
    themeId,
    setThemeId,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
  } = useWorkspaceTheme();

  const { lightThemes, darkThemes } = useMemo(() => ({
    lightThemes: themes.filter((t) => !t.isDark),
    darkThemes: themes.filter((t) => t.isDark),
  }), [themes]);

  // Connectors / providers
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(true);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadConnectors = async () => {
      try {
        const response = await fetch(`/api/u/${slug}/connectors`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { connectors?: ConnectorSummary[] } | null;
        if (!response.ok || cancelled) return;
        setConnectors(Array.isArray(data?.connectors) ? data.connectors : []);
      } finally {
        if (!cancelled) setIsLoadingConnectors(false);
      }
    };

    const loadProviders = async () => {
      try {
        const response = await fetch(`/api/u/${slug}/providers`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { providers?: ProviderSummary[] } | null;
        if (!response.ok || cancelled) return;
        setProviders(Array.isArray(data?.providers) ? data.providers : []);
      } finally {
        if (!cancelled) setIsLoadingProviders(false);
      }
    };

    loadConnectors().catch(() => { if (!cancelled) setIsLoadingConnectors(false); });
    loadProviders().catch(() => { if (!cancelled) setIsLoadingProviders(false); });

    const interval = setInterval(() => {
      loadConnectors().catch(() => {});
      loadProviders().catch(() => {});
    }, 30000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [slug]);

  const activeConnectors = useMemo(
    () => connectors.filter((c) => c.status === "ready").length,
    [connectors]
  );

  const activeProviders = useMemo(
    () => providers.filter((p) => p.status === "enabled"),
    [providers]
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

  const statusStyle = statusConfig[status];

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col text-card-foreground"
      style={{ gap: SECTION_GAP }}
    >
      {/* Panel header — logo, slug, status, toggle (no container) */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onNavigateDashboard}
          className="flex items-center gap-1.5 truncate transition-colors hover:opacity-80"
        >
          <span className="font-[family-name:var(--font-display)] text-base font-semibold tracking-tight">
            Archē
          </span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="truncate text-sm text-muted-foreground">{slug}</span>
        </button>
        <Circle
          size={8}
          weight="fill"
          className={cn(statusStyle.color, statusStyle.pulse && "animate-pulse")}
        />
        <button
          type="button"
          onClick={onToggleLeft}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          aria-label="Collapse panel"
        >
          <ArrowLineLeft size={14} weight="bold" />
        </button>
      </div>

      {/* Search bar (no container) */}
      <label className="mt-0.5 mb-1.5 flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-foreground/5 focus-within:bg-foreground/5">
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
        className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-foreground/[0.03]"
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
              unseenCompletedSessions={unseenCompletedSessions}
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
        className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-foreground/[0.03]"
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
        className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-foreground/[0.03]"
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

      {/* Bottom bar — connectors & providers (left) | sync, theme, settings (right) */}
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <TooltipProvider delayDuration={400}>
          {/* Left group: Connectors + Providers */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Connectors"
                  >
                    <Plugs size={14} weight="bold" />
                    {!isLoadingConnectors && <span className="tabular-nums">{activeConnectors}</span>}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Connectors</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="start" className="w-72">
              <DropdownMenuLabel>Connector status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {connectors.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No connectors configured.</p>
              ) : (
                <div className="space-y-1 px-1 py-1">
                  {connectors.map((connector) => {
                    const info = connectorStatusInfo(connector.status);
                    return (
                      <div key={connector.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{connector.name}</p>
                          <p className="text-[11px] text-muted-foreground">{connector.type}</p>
                        </div>
                        <div className="ml-3 flex items-center gap-1.5 text-muted-foreground">
                          <span className={cn("h-2 w-2 rounded-full", info.dotClassName)} />
                          <span>{info.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Providers"
                  >
                    <Cpu size={14} weight="bold" />
                    {!isLoadingProviders && <span className="tabular-nums">{activeProviders.length}</span>}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Providers</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="start" className="w-72">
              <DropdownMenuLabel>Provider status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isLoadingProviders ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading providers...</p>
              ) : activeProviders.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No active providers.</p>
              ) : (
                <div className="space-y-1 px-1 py-1">
                  {activeProviders.map((provider) => (
                    <div key={provider.providerId} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{providerLabel(provider.providerId)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {provider.type ?? "api"}
                          {provider.version ? ` · v${provider.version}` : ""}
                        </p>
                      </div>
                      <div className="ml-3 flex items-center gap-1.5 text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>Active</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right group: Sync + Theme + Settings */}
          <SyncKbButton
            slug={slug}
            disabled={status !== "active"}
            onComplete={onSyncComplete}
            variant="muted"
          />

          {/* Theme picker */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Change theme"
                  >
                    <Palette size={14} weight="bold" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Change theme</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="start" className="min-w-[220px]">
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Light</DropdownMenuLabel>
              {lightThemes.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => setThemeId(t.id)} className={cn("flex items-center gap-3", themeId === t.id && "bg-primary/10")}>
                  <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                    <div className="w-1/2" style={{ backgroundColor: t.swatches[0] }} />
                    <div className="w-1/2" style={{ backgroundColor: t.swatches[1] }} />
                  </div>
                  <span className="text-sm">{t.name}</span>
                  {themeId === t.id && <span className="ml-auto text-[10px] text-primary">Active</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Dark</DropdownMenuLabel>
              {darkThemes.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => setThemeId(t.id)} className={cn("flex items-center gap-3", themeId === t.id && "bg-primary/10")}>
                  <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                    <div className="w-1/2" style={{ backgroundColor: t.swatches[0] }} />
                    <div className="w-1/2" style={{ backgroundColor: t.swatches[1] }} />
                  </div>
                  <span className="text-sm">{t.name}</span>
                  {themeId === t.id && <span className="ml-auto text-[10px] text-primary">Active</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font style</span>
                  <span className="text-xs font-medium text-foreground/80">{chatFontFamily === "sans" ? "Sans" : "Serif"}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" size="sm" variant={chatFontFamily === "sans" ? "secondary" : "outline"} className="h-8" onClick={() => setChatFontFamily("sans")}>Sans</Button>
                  <Button type="button" size="sm" variant={chatFontFamily === "serif" ? "secondary" : "outline"} className="h-8" onClick={() => setChatFontFamily("serif")}>Serif</Button>
                </div>
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font size</span>
                  <span className="text-xs font-medium tabular-nums text-foreground/80">{chatFontSize}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={decreaseChatFontSize} disabled={!canDecreaseChatFontSize} aria-label="Decrease chat font size"><Minus size={14} weight="bold" /></Button>
                  <div className="flex-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-center text-xs text-muted-foreground">Chat only</div>
                  <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={increaseChatFontSize} disabled={!canIncreaseChatFontSize} aria-label="Increase chat font size"><Plus size={14} weight="bold" /></Button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onNavigateSettings}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                aria-label="Settings"
              >
                <GearSix size={14} weight="bold" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
