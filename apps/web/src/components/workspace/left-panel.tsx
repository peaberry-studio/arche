"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
   ArrowClockwise,
   ArrowLineRight,
   ChatCircle,
   Cpu,
   Database,
   GearSix,
  MagnifyingGlass,
  Minus,
  Moon,
  Palette,
  Plugs,
   Plus,
   Robot,
    ArrowLineLeft,
    Lightning,
    SlidersHorizontal,
    Sun,
    Warning,
    X,
} from "@phosphor-icons/react";

import { DesktopVaultSwitcher } from '@/components/desktop/desktop-vault-switcher'
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
import type { AgentCatalogItem } from "@/hooks/use-workspace";
import type { SkillListItem } from '@/hooks/use-skills-catalog'
import {
  getConfigChangeMessage,
  WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
  type ConfigChangeReason,
} from '@/lib/runtime/config-status-events'
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import { getProviderLabel } from "@/lib/providers/catalog";
import {
  DEFAULT_LEFT_PANEL_STATE,
  LEFT_PANEL_SECTION_IDS,
  getWorkspaceLeftPanelCookieName,
  getWorkspaceLeftPanelStorageKey,
  type LeftPanelSectionId,
  normalizeLeftPanelState,
  type NormalizedLeftPanelState,
  parseStoredLeftPanelState,
  persistWorkspacePanelState,
  readWorkspacePanelState,
  type StoredLeftPanelState,
} from "@/lib/workspace-panel-state";
import { cn } from "@/lib/utils";

import { AgentsPanel } from "./agents-panel";
import { FileTreePanel } from "./file-tree-panel";
import { SessionsPanel } from "./sessions-panel";
import { SkillsPanel } from './skills-panel'
import { SyncKbButton } from "./sync-kb-button";

const MIN_SECTION_PX = 60;
const SECTION_GAP = 12; // matches gap-3 between main panels
const HEADER_HEIGHT = 32; // h-8
const ANIM = "200ms ease-out";
const FLEX_TRANSITION = `flex-grow ${ANIM}, flex-basis ${ANIM}`;
const GRID_TRANSITION = `grid-template-rows ${ANIM}`;

function loadStoredLeftPanelState(storageKey: string, cookieName: string): StoredLeftPanelState | null {
  return readWorkspacePanelState(storageKey, cookieName, parseStoredLeftPanelState);
}

function persistLeftPanelState(storageKey: string, cookieName: string, state: NormalizedLeftPanelState) {
  persistWorkspacePanelState(storageKey, cookieName, state);
}

function getInitialLeftPanelState(
  storageKey: string,
  cookieName: string,
  initialPanelState?: NormalizedLeftPanelState | null,
): NormalizedLeftPanelState {
  const stored = loadStoredLeftPanelState(storageKey, cookieName);
  if (stored) return normalizeLeftPanelState(stored);
  if (initialPanelState) return initialPanelState;
  return DEFAULT_LEFT_PANEL_STATE;
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

function connectorStatusInfo(status: ConnectorStatus): { label: string; dotClassName: string } {
  if (status === "ready") return { label: "Working", dotClassName: "bg-emerald-500" };
  if (status === "pending") return { label: "Pending", dotClassName: "bg-amber-500" };
  return { label: "Not working", dotClassName: "bg-rose-500" };
}

// --- Props ---

type LeftPanelProps = {
  slug: string;
  persistenceScope?: string;
  currentVault?: {
    id: string;
    name: string;
    path: string;
  } | null;
  status: "active" | "provisioning" | "offline";
  configChangePending?: boolean;
  configChangeReason?: ConfigChangeReason | null;
  configRestartError?: string | null;
  configRestarting?: boolean;
  leftCollapsed: boolean;
  onRestartConfig?: () => void;
  onToggleLeft: () => void;
  onSyncComplete?: (status: SyncKbResult["status"]) => void;
  onNavigateDashboard: () => void;
  onNavigateSettings: () => void;
  onNavigateConnectors?: () => void;
  onNavigateProviders?: () => void;

  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  unseenCompletedSessions: ReadonlySet<string>;
  onSelectSession: (id: string) => void;
  onMarkAutopilotRunSeen?: (runId: string) => Promise<void> | void;
  onCreateSession: () => void;
  onOpenAutopilotSettings?: () => void;

  // Agents
  agents: AgentCatalogItem[];
  onSelectAgent: (agent: AgentCatalogItem) => void;
  onOpenExpertsSettings: () => void;

  // Skills
  skills: SkillListItem[];
  onSelectSkill: (skill: SkillListItem) => void;
  onOpenSkillsSettings: () => void;

  // Knowledge (file tree)
  fileNodes: WorkspaceFileNode[];
  activeFilePath?: string | null;
  onSelectFile: (path: string) => void;
  onDownloadFile?: (path: string) => void;
  onCreateKnowledgeFile: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  canCreateKnowledgeFile?: boolean;
  hideCollapseButton?: boolean;
  initialPanelState?: NormalizedLeftPanelState | null;
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
  configChangePending,
  configChangeReason,
  configRestartError,
  configRestarting,
  showConfigRestartNotice,
  status,
  onRestartConfig,
  onCreateSession,
  onToggleLeft,
  onExpandWithSection,
  onSyncComplete,
  onNavigateSettings,
}: {
  slug: string;
  configChangePending?: boolean;
  configChangeReason?: ConfigChangeReason | null;
  configRestartError?: string | null;
  configRestarting?: boolean;
  status: "active" | "provisioning" | "offline";
  onRestartConfig?: () => void;
  showConfigRestartNotice?: boolean;
  onCreateSession: () => void;
  onToggleLeft: () => void;
  onExpandWithSection: (section: "chats" | "knowledge" | "experts" | "skills") => void;
  onSyncComplete?: (status: SyncKbResult["status"]) => void;
  onNavigateSettings: () => void;
}) {
  const {
    themes,
    themeId,
    setThemeId,
    isDark,
    toggleDark,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
  } = useWorkspaceTheme();

  const showRestartNotice = Boolean(showConfigRestartNotice && (configChangePending || configRestartError) && onRestartConfig);
  const restartTooltipLabel = configRestartError
    ? `Restart failed: ${configRestartError}`
    : getConfigChangeMessage(configChangeReason ?? null);

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
              onClick={onCreateSession}
              className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary transition-colors hover:bg-primary/18"
              aria-label="New chat"
            >
              <Plus size={16} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New chat</TooltipContent>
        </Tooltip>

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

         <Tooltip>
           <TooltipTrigger asChild>
             <button
               type="button"
               onClick={() => onExpandWithSection("skills")}
               className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
               aria-label="Skills"
             >
               <Lightning size={16} weight="bold" />
             </button>
           </TooltipTrigger>
           <TooltipContent side="right">Skills</TooltipContent>
         </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {showRestartNotice ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRestartConfig}
                className={cn(
                  "mb-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  configRestartError
                    ? "bg-destructive/15 text-destructive hover:bg-destructive/20"
                    : "bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300",
                )}
                aria-label="Restart workspace to apply changes"
              >
                {configRestartError ? (
                  <Warning size={16} weight="bold" />
                ) : (
                  <ArrowClockwise
                    size={16}
                    weight="bold"
                    className={cn(configRestarting && "animate-spin")}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{restartTooltipLabel}</TooltipContent>
          </Tooltip>
        ) : null}

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
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Theme</DropdownMenuLabel>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {themes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setThemeId(t.id)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all",
                    themeId === t.id ? "border-foreground" : "border-transparent hover:scale-110",
                  )}
                  aria-label={t.name}
                  title={t.name}
                >
                  <div className="h-5 w-5 rounded-full" style={{ backgroundColor: t.swatch }} />
                </button>
              ))}
              <div className="mx-0.5 h-5 w-px bg-border/60" />
              <button
                type="button"
                onClick={toggleDark}
                className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5"
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                title={isDark ? "Light mode" : "Dark mode"}
              >
                <Sun size={14} weight="bold" className={cn("absolute transition-all duration-300", isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
                <Moon size={14} weight="bold" className={cn("absolute transition-all duration-300", isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
              </button>
            </div>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <div className="mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font style</span>
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
  persistenceScope,
  currentVault,
  status,
  configChangePending,
  configChangeReason,
  configRestartError,
  configRestarting,
  leftCollapsed,
  onRestartConfig,
  onToggleLeft,
  onSyncComplete,
  onNavigateDashboard,
  onNavigateSettings,
  onNavigateConnectors,
  onNavigateProviders,
  sessions,
  activeSessionId,
  unseenCompletedSessions,
  onSelectSession,
  onMarkAutopilotRunSeen,
  onCreateSession,
  onOpenAutopilotSettings,
  agents,
  onSelectAgent,
  onOpenExpertsSettings,
  skills,
  onSelectSkill,
  onOpenSkillsSettings,
  fileNodes,
  activeFilePath,
  onSelectFile,
  onDownloadFile,
  onCreateKnowledgeFile,
  canCreateKnowledgeFile = true,
  hideCollapseButton = false,
  initialPanelState,
  searchInputRef,

}: LeftPanelProps) {
  const pendingSectionRef = useRef<"chats" | "knowledge" | "experts" | "skills" | null>(null);

  const handleExpandWithSection = useCallback((section: "chats" | "knowledge" | "experts" | "skills") => {
    pendingSectionRef.current = section;
    onToggleLeft();
  }, [onToggleLeft]);

  // --- Minified state ---
  if (leftCollapsed) {
    return (
        <MinifiedLeftPanel
          slug={slug}
          configChangePending={configChangePending}
          configChangeReason={configChangeReason}
          configRestartError={configRestartError}
          configRestarting={configRestarting}
          showConfigRestartNotice={Boolean(currentVault)}
         status={status}
         onRestartConfig={onRestartConfig}
         onCreateSession={onCreateSession}
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
      persistenceScope={persistenceScope}
      currentVault={currentVault}
      status={status}
      configChangePending={configChangePending}
      configChangeReason={configChangeReason}
      configRestartError={configRestartError}
      configRestarting={configRestarting}
      leftCollapsed={leftCollapsed}
      onRestartConfig={onRestartConfig}
      onToggleLeft={onToggleLeft}
      onSyncComplete={onSyncComplete}
      onNavigateDashboard={onNavigateDashboard}
      onNavigateSettings={onNavigateSettings}
      onNavigateConnectors={onNavigateConnectors}
      onNavigateProviders={onNavigateProviders}
       sessions={sessions}
        activeSessionId={activeSessionId}
        unseenCompletedSessions={unseenCompletedSessions}
        onSelectSession={onSelectSession}
        onMarkAutopilotRunSeen={onMarkAutopilotRunSeen}
        onCreateSession={onCreateSession}
        onOpenAutopilotSettings={onOpenAutopilotSettings}
        agents={agents}
        onSelectAgent={onSelectAgent}
        onOpenExpertsSettings={onOpenExpertsSettings}
        skills={skills}
        onSelectSkill={onSelectSkill}
        onOpenSkillsSettings={onOpenSkillsSettings}
        fileNodes={fileNodes}
      activeFilePath={activeFilePath}
      onSelectFile={onSelectFile}
      onDownloadFile={onDownloadFile}
      onCreateKnowledgeFile={onCreateKnowledgeFile}
      canCreateKnowledgeFile={canCreateKnowledgeFile}
      hideCollapseButton={hideCollapseButton}
      initialPanelState={initialPanelState}
      searchInputRef={searchInputRef}
      pendingSectionRef={pendingSectionRef}
    />
  );
}

function ExpandedLeftPanel({
  slug,
  persistenceScope,
  currentVault,
  status,
  configChangePending = false,
  configChangeReason = null,
  configRestartError = null,
  configRestarting = false,
  onToggleLeft,
  onSyncComplete,
  onNavigateDashboard,
  onNavigateSettings,
  onNavigateConnectors,
  onNavigateProviders,
  onRestartConfig,
  sessions,
  activeSessionId,
  unseenCompletedSessions,
  onSelectSession,
  onMarkAutopilotRunSeen,
  onCreateSession,
  onOpenAutopilotSettings,
  agents,
  onSelectAgent,
  onOpenExpertsSettings,
  skills,
  onSelectSkill,
  onOpenSkillsSettings,
  fileNodes,
  activeFilePath,
  onSelectFile,
  onDownloadFile,
  onCreateKnowledgeFile,
  canCreateKnowledgeFile = true,
  hideCollapseButton = false,
  initialPanelState,
  searchInputRef,
  pendingSectionRef,
}: LeftPanelProps & { pendingSectionRef?: RefObject<"chats" | "knowledge" | "experts" | "skills" | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const newFileNameRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionListMode, setSessionListMode] = useState<"chats" | "tasks">("chats");
  const autoSwitchedToTasksRef = useRef(false);
  const [isCreateFileDialogOpen, setIsCreateFileDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState("");
  const [createFileError, setCreateFileError] = useState<string | null>(null);
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const resolvedPersistenceScope = persistenceScope ?? slug;
  const leftPanelCookieName = useMemo(() => getWorkspaceLeftPanelCookieName(resolvedPersistenceScope), [resolvedPersistenceScope]);
  const leftPanelStorageKey = useMemo(() => getWorkspaceLeftPanelStorageKey(resolvedPersistenceScope), [resolvedPersistenceScope]);
  const resolvedInitialPanelState = useMemo(
    () => getInitialLeftPanelState(leftPanelStorageKey, leftPanelCookieName, initialPanelState),
    [initialPanelState, leftPanelCookieName, leftPanelStorageKey]
  );
  const supportsAutopilotTasks = !currentVault;
  const showRestartNotice = Boolean(currentVault && (configChangePending || configRestartError) && onRestartConfig);

  const sectionOrder = LEFT_PANEL_SECTION_IDS;
  const [ratios, setRatios] = useState(resolvedInitialPanelState.ratios);
  const [collapsedSections, setCollapsedSections] = useState<Record<LeftPanelSectionId, boolean>>({
    ...resolvedInitialPanelState.collapsed,
    chats: false,
  });
  const manualSessions = useMemo(
    () => sessions.filter((session) => !session.autopilot),
    [sessions]
  );
  const taskSessions = useMemo(
    () => sessions.filter((session) => Boolean(session.autopilot)),
    [sessions]
  );
  const unseenTaskSessionsCount = useMemo(
    () => taskSessions.filter((session) => session.autopilot?.hasUnseenResult).length,
    [taskSessions]
  );
  const visibleSessions = supportsAutopilotTasks && sessionListMode === "tasks" ? taskSessions : manualSessions;

  useEffect(() => {
    if (!supportsAutopilotTasks || autoSwitchedToTasksRef.current || sessionListMode === "tasks" || !activeSessionId) {
      return;
    }

    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if (!activeSession?.autopilot) {
      return;
    }

    autoSwitchedToTasksRef.current = true;
    setSessionListMode("tasks");
  }, [activeSessionId, sessionListMode, sessions, supportsAutopilotTasks]);

  // Expand the requested section when coming from a minified panel click
  useEffect(() => {
    const section = pendingSectionRef?.current;
    if (!section) return;
    pendingSectionRef.current = null;
    if (section === "chats") {
      setSessionListMode("chats");
      return;
    }
    setCollapsedSections((current) => ({ ...current, [section]: false }));
  }, [pendingSectionRef]);

  const directoryOptions = useMemo(
    () => collectDirectoryOptions(fileNodes),
    [fileNodes]
  );

  // Theme
  const {
    themes,
    themeId,
    setThemeId,
    isDark,
    toggleDark,
    chatFontFamily,
    setChatFontFamily,
    chatFontSize,
    increaseChatFontSize,
    decreaseChatFontSize,
    canIncreaseChatFontSize,
    canDecreaseChatFontSize,
  } = useWorkspaceTheme();

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

    const reloadWorkspaceIntegrations = () => {
      loadConnectors().catch(() => {
        if (!cancelled) setIsLoadingConnectors(false);
      });
      loadProviders().catch(() => {
        if (!cancelled) setIsLoadingProviders(false);
      });
    };

    reloadWorkspaceIntegrations();

    const handleWorkspaceConfigChanged = () => {
      reloadWorkspaceIntegrations();
    };

    window.addEventListener(
      WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
      handleWorkspaceConfigChanged
    );

    const interval = setInterval(() => {
      reloadWorkspaceIntegrations();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(
        WORKSPACE_CONFIG_STATUS_CHANGED_EVENT,
        handleWorkspaceConfigChanged
      );
    };
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
    persistLeftPanelState(leftPanelStorageKey, leftPanelCookieName, {
      ratios,
      collapsed: {
        ...collapsedSections,
        chats: false,
      },
    });
  }, [collapsedSections, leftPanelCookieName, leftPanelStorageKey, ratios]);

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

  const resizableSectionOrder = useMemo(
    () => sectionOrder,
    [sectionOrder]
  );

  const expandedRatioTotal = useMemo(
    () => resizableSectionOrder.reduce((sum, sectionId) => sum + (collapsedSections[sectionId] ? 0 : ratios[sectionId]), 0),
    [collapsedSections, ratios, resizableSectionOrder]
  );

  const effectiveRatios = useMemo(
    () => Object.fromEntries(
      resizableSectionOrder.map((sectionId) => [
        sectionId,
        expandedRatioTotal > 0 ? ratios[sectionId] / expandedRatioTotal : 1 / resizableSectionOrder.length,
      ])
    ) as Record<LeftPanelSectionId, number>,
    [expandedRatioTotal, ratios, resizableSectionOrder]
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);

      const selectedSession = sessions.find((session) => session.id === sessionId);
      const autopilot = selectedSession?.autopilot;
      if (!autopilot?.hasUnseenResult) {
        return;
      }

      void onMarkAutopilotRunSeen?.(autopilot.runId);
    },
    [onMarkAutopilotRunSeen, onSelectSession, sessions]
  );

  const handleResize = useCallback(
    (firstSectionId: LeftPanelSectionId, secondSectionId: LeftPanelSectionId, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const containerHeight = container.getBoundingClientRect().height;
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startFirstRatio = ratios[firstSectionId];
      const startSecondRatio = ratios[secondSectionId];

      setIsDragging(true);
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const deltaRatio = deltaY / containerHeight;
        const minRatio = MIN_SECTION_PX / containerHeight;

        let nextFirstRatio = startFirstRatio + deltaRatio;
        let nextSecondRatio = startSecondRatio - deltaRatio;

        if (nextFirstRatio < minRatio) {
          nextSecondRatio -= minRatio - nextFirstRatio;
          nextFirstRatio = minRatio;
        }

        if (nextSecondRatio < minRatio) {
          nextFirstRatio -= minRatio - nextSecondRatio;
          nextSecondRatio = minRatio;
        }

        if (nextFirstRatio < minRatio || nextSecondRatio < minRatio) {
          return;
        }

        setRatios((current) => ({
          ...current,
          [firstSectionId]: nextFirstRatio,
          [secondSectionId]: nextSecondRatio,
        }));
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
    [ratios]
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

  const sectionItems: Array<{
    actionIcon?: typeof Plus
    actionLabel?: string
    collapsible?: boolean
    content: React.ReactNode
    customHeader?: React.ReactNode
    icon: typeof ChatCircle
    id: LeftPanelSectionId
    label: string
    onAction?: () => void
  }> = [
    {
      id: "chats",
      icon: ChatCircle,
      label: "Chats",
      collapsible: false,
      customHeader: (
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1">
          {supportsAutopilotTasks ? (
            <div className="inline-flex h-8 items-center rounded-lg bg-foreground/[0.06] p-0.5">
              <button
                type="button"
                onClick={() => setSessionListMode("chats")}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all",
                  sessionListMode === "chats"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={sessionListMode === "chats"}
              >
                Chats
              </button>
              <button
                type="button"
                onClick={() => setSessionListMode("tasks")}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all",
                  sessionListMode === "tasks"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={sessionListMode === "tasks"}
              >
                Tasks
                {unseenTaskSessionsCount > 0 ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {unseenTaskSessionsCount > 99 ? "99+" : unseenTaskSessionsCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5 px-0.5">
              <ChatCircle size={14} weight="bold" className="text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Chats
              </span>
            </div>
          )}

          {supportsAutopilotTasks && sessionListMode === "tasks" && onOpenAutopilotSettings ? (
            <button
              type="button"
              onClick={onOpenAutopilotSettings}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="Manage tasks"
            >
              <SlidersHorizontal size={14} weight="bold" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreateSession}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="New chat"
            >
              <Plus size={14} weight="bold" />
            </button>
          )}
        </div>
      ),
      content: (
        <SessionsPanel
          kind={sessionListMode}
          sessions={visibleSessions}
          activeSessionId={activeSessionId}
          unseenCompletedSessions={unseenCompletedSessions}
          onSelectSession={handleSelectSession}
          onCreateSession={onCreateSession}
          query={searchQuery}
        />
      ),
    },
    {
      id: "knowledge",
      icon: Database,
      label: "Knowledge",
      onAction: canCreateKnowledgeFile ? handleOpenCreateFileDialog : undefined,
      actionIcon: canCreateKnowledgeFile ? Plus : undefined,
      actionLabel: canCreateKnowledgeFile ? "Create file" : undefined,
      content: (
        <FileTreePanel
          nodes={fileNodes}
          activePath={activeFilePath}
          onSelect={onSelectFile}
          onDownloadFile={onDownloadFile}
          hideHeader
          query={searchQuery}
        />
      ),
    },
    {
      id: "experts",
      icon: Robot,
      label: "Experts",
      onAction: onOpenExpertsSettings,
      actionIcon: SlidersHorizontal,
      actionLabel: "Edit experts",
      content: <AgentsPanel agents={agents} onSelectAgent={onSelectAgent} query={searchQuery} />,
    },
    {
      id: "skills",
      icon: Lightning,
      label: "Skills",
      onAction: onOpenSkillsSettings,
      actionIcon: SlidersHorizontal,
      actionLabel: "Edit skills",
      content: <SkillsPanel skills={skills} onSelectSkill={onSelectSkill} query={searchQuery} />,
    },
  ];

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col text-card-foreground"
      style={{ gap: SECTION_GAP }}
    >
      {/* Panel header — logo, slug, status, toggle (no container) */}
      <div className="flex h-10 shrink-0 items-center gap-2 pl-1 pr-3">
        {currentVault ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="type-display shrink-0 text-base font-semibold tracking-tight">Archē</span>
            <span className="text-sm text-muted-foreground">/</span>
            <DesktopVaultSwitcher currentVault={currentVault} />
          </div>
        ) : (
          <button
            type="button"
            onClick={onNavigateDashboard}
            className="flex items-center gap-1.5 truncate transition-colors hover:opacity-80"
          >
            <span className="type-display text-base font-semibold tracking-tight">
              Archē
            </span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="truncate text-sm text-muted-foreground">{slug}</span>
          </button>
        )}
        {!hideCollapseButton && (
          <button
            type="button"
            onClick={onToggleLeft}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Collapse panel"
          >
            <ArrowLineLeft size={14} weight="bold" />
          </button>
        )}
      </div>

      {/* Search bar (no container) */}
      <label className="mt-0.5 mb-1.5 flex shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 transition-colors hover:bg-foreground/5 focus-within:bg-foreground/5">
          <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground/50" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search..."
            aria-label={
              supportsAutopilotTasks
                ? "Search chats, tasks, knowledge, experts, and skills"
                : "Search chats, knowledge, experts, and skills"
            }
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

      {sectionItems.map((section, index) => {
        const nextSection = sectionItems[index + 1]
        const isCollapsed = section.collapsible === false ? false : collapsedSections[section.id]

        return (
          <div key={section.id} className="contents">
            <div
              style={sectionStyle(isCollapsed, effectiveRatios[section.id])}
              className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-foreground/[0.03]"
            >
              {section.customHeader ?? (
                <SectionHeader
                  icon={section.icon}
                  label={section.label}
                  onToggle={() => setCollapsedSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
                  onAction={section.onAction}
                  actionIcon={section.actionIcon}
                  actionLabel={section.actionLabel}
                />
              )}
              <div className="min-h-0 flex-1" style={contentStyle(isCollapsed)}>
                <div className="flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
                  {section.content}
                </div>
              </div>
            </div>

            {nextSection && !isCollapsed && !(nextSection.collapsible === false ? false : collapsedSections[nextSection.id]) ? (
              <div
                className="group relative h-0 w-full shrink-0 cursor-row-resize"
                onPointerDown={(event) => handleResize(section.id, nextSection.id, event)}
                role="separator"
                aria-orientation="horizontal"
                style={{ marginTop: -SECTION_GAP / 2, marginBottom: -SECTION_GAP / 2 }}
              >
                <div className="absolute -top-1 -bottom-1 left-0 right-0" />
              </div>
            ) : null}
          </div>
        )
      })}

      {showRestartNotice ? (
        <div
          className={cn(
            "shrink-0 rounded-xl border px-3 py-3",
            configRestartError
              ? "border-destructive/30 bg-destructive/10"
              : "border-amber-500/30 bg-amber-500/10 dark:border-amber-400/30 dark:bg-amber-400/10",
          )}
        >
          <div className="flex items-start gap-2">
            <Warning
              size={16}
              weight="fill"
              className={cn(
                "mt-0.5 shrink-0",
                configRestartError ? "text-destructive" : "text-amber-700 dark:text-amber-300",
              )}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                  Pending changes
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {configRestartError
                    ? `Restart failed: ${configRestartError}`
                    : `${getConfigChangeMessage(configChangeReason)} Restart now to apply them.`}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={onRestartConfig}
                disabled={configRestarting}
              >
                <ArrowClockwise
                  size={14}
                  weight="bold"
                  className={cn(configRestarting && "animate-spin")}
                />
                {configRestarting ? "Restarting..." : "Restart now"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-sm font-semibold">Connector status</span>
                {onNavigateConnectors && (
                  <button
                    type="button"
                    onClick={onNavigateConnectors}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Connector settings"
                  >
                    <GearSix size={14} weight="bold" />
                  </button>
                )}
              </div>
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
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-sm font-semibold">Provider status</span>
                {onNavigateProviders && (
                  <button
                    type="button"
                    onClick={onNavigateProviders}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    aria-label="Provider settings"
                  >
                    <GearSix size={14} weight="bold" />
                  </button>
                )}
              </div>
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
                        <p className="truncate text-sm text-foreground">{getProviderLabel(provider.providerId)}</p>
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
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Theme</DropdownMenuLabel>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setThemeId(t.id)}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all",
                      themeId === t.id ? "border-foreground" : "border-transparent hover:scale-110",
                    )}
                    aria-label={t.name}
                    title={t.name}
                  >
                    <div className="h-5 w-5 rounded-full" style={{ backgroundColor: t.swatch }} />
                  </button>
                ))}
                <div className="mx-0.5 h-5 w-px bg-border/60" />
                <button
                  type="button"
                  onClick={toggleDark}
                  className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5"
                  aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                  title={isDark ? "Light mode" : "Dark mode"}
                >
                  <Sun size={14} weight="bold" className={cn("absolute transition-all duration-300", isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
                  <Moon size={14} weight="bold" className={cn("absolute transition-all duration-300", isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
                </button>
              </div>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="mb-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Font style</span>
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
