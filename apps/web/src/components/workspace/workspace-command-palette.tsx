"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ChatCircle,
  Cpu,
  Database,
  File,
  GearSix,
  GitBranch,
  Moon,
  Palette,
  Plugs,
  Sidebar,
  Sparkle,
} from "@phosphor-icons/react";

import { listSessionsAction, searchFilesAction } from "@/actions/opencode";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useFlowRunner } from "@/hooks/use-flow-runner";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import { isFlowSession } from "@/lib/workspace-session-utils";
import type { WorkspaceThemeId } from "@/lib/workspace-theme";

import type { WorkspaceMode } from "./workspace-mode-toggle";

type WorkspaceCommandPaletteProps = {
  fileNodes?: WorkspaceFileNode[];
  slug: string;
  open: boolean;
  hideFlows: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSession: () => Promise<void> | void;
  onModeChange: (mode: WorkspaceMode) => void;
  onOpenFile?: (path: string) => Promise<void> | void;
  onNavigateConnectors: () => void;
  onNavigateProviders: () => void;
  onNavigateSettings: () => void;
  onRefreshSessions: () => Promise<void> | void;
  onSelectSession: (sessionId: string, mode: WorkspaceMode) => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
};

type PaletteItem = {
  id: string;
  title: string;
  subtitle: string;
  section: string;
  icon: ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;
  keywords?: string;
  run: () => Promise<void> | void;
};

const SESSION_SEARCH_SCAN_LIMIT = 100;
const SESSION_SEARCH_RESULT_LIMIT = 20;
const FILE_SEARCH_RESULT_LIMIT = 15;

type FileSearchCandidate = {
  name: string;
  path: string;
};

function flattenFileNodes(nodes: WorkspaceFileNode[]): FileSearchCandidate[] {
  const result: FileSearchCandidate[] = [];

  for (const node of nodes) {
    if (node.type === "file") {
      result.push({ name: node.name, path: node.path });
      continue;
    }

    if (node.children && node.children.length > 0) {
      result.push(...flattenFileNodes(node.children));
    }
  }

  return result;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function fuzzyScore(value: string, token: string): number | null {
  const exactIndex = value.indexOf(token);
  if (exactIndex >= 0) return exactIndex;

  let valueIndex = 0;
  let previousMatchIndex = -1;
  let score = 50;

  for (const character of token) {
    const matchIndex = value.indexOf(character, valueIndex);
    if (matchIndex === -1) return null;

    score += matchIndex;
    if (previousMatchIndex >= 0 && matchIndex !== previousMatchIndex + 1) {
      score += 8;
    }

    previousMatchIndex = matchIndex;
    valueIndex = matchIndex + 1;
  }

  return score;
}

function scoreFileMatch(file: FileSearchCandidate, query: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const nameScore = fuzzyScore(name, token);
    const pathScore = fuzzyScore(path, token);
    if (nameScore === null && pathScore === null) return null;

    score += Math.min(
      nameScore ?? Number.POSITIVE_INFINITY,
      pathScore === null ? Number.POSITIVE_INFINITY : pathScore + 12
    );
  }

  return score + file.path.length / 1000;
}

function matchesQuery(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.subtitle} ${item.section} ${item.keywords ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function WorkspaceCommandPalette({
  fileNodes = [],
  slug,
  open,
  hideFlows,
  onOpenChange,
  onCreateSession,
  onModeChange,
  onOpenFile,
  onNavigateConnectors,
  onNavigateProviders,
  onNavigateSettings,
  onRefreshSessions,
  onSelectSession,
  onToggleLeftPanel,
  onToggleRightPanel,
}: WorkspaceCommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false);
  const [sessionResults, setSessionResults] = useState<WorkspaceSession[]>([]);
  const [isSearchingSessions, setIsSearchingSessions] = useState(false);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [isSearchingFiles, setIsSearchingFiles] = useState(false);
  const { themes, themeId, setThemeId, toggleDark } = useWorkspaceTheme();
  const {
    flows,
    isLoadingFlows,
    runningFlowId,
    runError,
    loadFlows,
    runFlow,
  } = useFlowRunner({ slug, onRunFlowComplete: onRefreshSessions });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (nextOpen) return;
      setQuery("");
      setActiveIndex(0);
      setIsKeyboardNavigating(false);
      setSessionResults([]);
      setIsSearchingSessions(false);
      setFileResults([]);
      setIsSearchingFiles(false);
    },
    [onOpenChange]
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
    requestAnimationFrame(() => itemRefs.current[0]?.scrollIntoView({ block: "nearest" }));
    if (value.trim()) {
      setIsSearchingSessions(true);
      setIsSearchingFiles(Boolean(onOpenFile));
      return;
    }
    setSessionResults([]);
    setIsSearchingSessions(false);
    setFileResults([]);
    setIsSearchingFiles(false);
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!hideFlows) {
      void loadFlows();
    }
  }, [hideFlows, loadFlows, open]);

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const sessionSearch = listSessionsAction(slug, {
        limit: SESSION_SEARCH_SCAN_LIMIT,
        query: trimmedQuery,
        rootsOnly: true,
      });
      const fileSearch = onOpenFile
        ? searchFilesAction(slug, trimmedQuery)
        : Promise.resolve({ ok: true, files: [] as string[] });

      void Promise.all([sessionSearch, fileSearch]).then(([sessionResult, fileResult]) => {
        if (cancelled) return;
        setSessionResults(sessionResult.ok ? (sessionResult.sessions ?? []).slice(0, SESSION_SEARCH_RESULT_LIMIT) : []);
        setFileResults(fileResult.ok ? (fileResult.files ?? []) : []);
        setIsSearchingSessions(false);
        setIsSearchingFiles(false);
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [onOpenFile, open, query, slug]);

  const closeAndRun = useCallback(
    async (run: () => Promise<void> | void) => {
      handleOpenChange(false);
      await run();
    },
    [handleOpenChange]
  );

  const baseItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "mode-sessions",
        title: "Go to Sessions mode",
        subtitle: "Show chats and conversation history",
        section: "Modes",
        icon: ChatCircle,
        keywords: "chat conversations",
        run: () => onModeChange("chat"),
      },
      {
        id: "mode-knowledge",
        title: "Go to Knowledge mode",
        subtitle: "Browse files and knowledge graph",
        section: "Modes",
        icon: Database,
        keywords: "files graph kb",
        run: () => onModeChange("knowledge"),
      },
      {
        id: "new-chat",
        title: "New chat",
        subtitle: "Start a fresh workspace session",
        section: "Actions",
        icon: Sparkle,
        keywords: "session conversation",
        run: async () => {
          onModeChange("chat");
          await onCreateSession();
        },
      },
      {
        id: "settings",
        title: "Open settings",
        subtitle: "Manage workspace preferences",
        section: "Navigation",
        icon: GearSix,
        run: onNavigateSettings,
      },
      {
        id: "connectors",
        title: "Open connectors",
        subtitle: "Manage connected tools and services",
        section: "Navigation",
        icon: Plugs,
        run: onNavigateConnectors,
      },
      {
        id: "providers",
        title: "Open providers",
        subtitle: "Manage model provider credentials",
        section: "Navigation",
        icon: Cpu,
        run: onNavigateProviders,
      },
      {
        id: "toggle-left-panel",
        title: "Toggle left panel",
        subtitle: "Show or hide workspace navigation",
        section: "Layout",
        icon: Sidebar,
        keywords: "sessions knowledge tree",
        run: onToggleLeftPanel,
      },
      {
        id: "toggle-right-panel",
        title: "Toggle right panel",
        subtitle: "Show or hide review and files panel",
        section: "Layout",
        icon: File,
        keywords: "review inspector diff files",
        run: onToggleRightPanel,
      },
      {
        id: "toggle-dark-mode",
        title: "Toggle dark mode",
        subtitle: "Switch between light and dark appearance",
        section: "Appearance",
        icon: Moon,
        keywords: "theme appearance light",
        run: toggleDark,
      },
    ];

    if (!hideFlows) {
      items.splice(1, 0, {
        id: "mode-flows",
        title: "Go to Flows mode",
        subtitle: "Show flow runs",
        section: "Modes",
        icon: GitBranch,
        keywords: "flows automation runs",
        run: () => onModeChange("flows"),
      });
    }

    for (const theme of themes) {
      items.push({
        id: `theme-${theme.id}`,
        title: `Change theme to ${theme.name}`,
        subtitle: theme.id === themeId ? "Current theme" : "Apply workspace color theme",
        section: "Appearance",
        icon: Palette,
        keywords: `theme ${theme.name}`,
        run: () => setThemeId(theme.id as WorkspaceThemeId),
      });
    }

    return items;
  }, [hideFlows, onCreateSession, onModeChange, onNavigateConnectors, onNavigateProviders, onNavigateSettings, onToggleLeftPanel, onToggleRightPanel, setThemeId, themeId, themes, toggleDark]);

  const flowItems = useMemo<PaletteItem[]>(() => {
    if (hideFlows) return [];
    return flows.map((flow) => ({
      id: `run-flow-${flow.id}`,
      title: `Run flow: ${flow.name}`,
      subtitle: flow.description ?? `${flow.definition.nodes.length} nodes`,
      section: "Flows",
      icon: GitBranch,
      keywords: "flows automation",
      run: async () => {
        onModeChange("flows");
        await runFlow(flow.id);
      },
    }));
  }, [flows, hideFlows, onModeChange, runFlow]);

  const sessionItems = useMemo<PaletteItem[]>(() => {
    return sessionResults
      .filter((session) => !hideFlows || !isFlowSession(session))
      .map((session) => {
        const isFlowRun = isFlowSession(session);
        return {
          id: `session-${session.id}`,
          title: session.title,
          subtitle: isFlowRun
            ? `Flow run${session.flow?.flowName ? `: ${session.flow.flowName}` : ""}`
            : "Chat session",
          section: isFlowRun ? "Flow runs" : "Chats",
          icon: isFlowRun ? GitBranch : ChatCircle,
          keywords: session.flow?.flowName,
          run: () => onSelectSession(session.id, isFlowRun ? "flows" : "chat"),
        };
      });
  }, [hideFlows, onSelectSession, sessionResults]);

  const localFiles = useMemo(() => flattenFileNodes(fileNodes), [fileNodes]);

  const fileItems = useMemo<PaletteItem[]>(() => {
    const trimmedQuery = query.trim();
    if (!onOpenFile || !trimmedQuery) return [];

    const candidatesByPath = new Map<string, FileSearchCandidate>();
    for (const file of localFiles) {
      candidatesByPath.set(file.path, file);
    }
    for (const path of fileResults) {
      if (!candidatesByPath.has(path)) {
        candidatesByPath.set(path, { name: basename(path), path });
      }
    }

    return Array.from(candidatesByPath.values())
      .map((file) => ({ file, score: scoreFileMatch(file, trimmedQuery) }))
      .filter((candidate): candidate is { file: FileSearchCandidate; score: number } => candidate.score !== null)
      .sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path))
      .slice(0, FILE_SEARCH_RESULT_LIMIT)
      .map(({ file }) => ({
        id: `file-${file.path}`,
        title: file.name,
        subtitle: file.path,
        section: "Files",
        icon: File,
        keywords: file.path,
        run: async () => {
          onModeChange("knowledge");
          await onOpenFile(file.path);
        },
      }));
  }, [fileResults, localFiles, onModeChange, onOpenFile, query]);

  const visibleItems = useMemo(() => {
    const trimmedQuery = query.trim();
    return [...baseItems, ...flowItems]
      .filter((item) => matchesQuery(item, trimmedQuery))
      .concat(fileItems, sessionItems);
  }, [baseItems, fileItems, flowItems, query, sessionItems]);

  const boundedActiveIndex = Math.min(activeIndex, Math.max(visibleItems.length - 1, 0));
  const activeItem = visibleItems[boundedActiveIndex] ?? null;

  const moveActiveIndex = (nextIndex: number) => {
    setIsKeyboardNavigating(true);
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => itemRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" }));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex(Math.min(boundedActiveIndex + 1, Math.max(visibleItems.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(Math.max(boundedActiveIndex - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      void closeAndRun(activeItem.run);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="top-4 max-w-[calc(100vw-1rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12vh] sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Workspace command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search workspace commands, files, chats, flow runs, and settings.
        </DialogDescription>
        <div className="border-b border-border/50 p-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, files, chats, flows..."
            className="h-11 border-0 bg-muted/40 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="scrollbar-custom max-h-[min(28rem,60vh)] overflow-y-auto p-2">
          {visibleItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {isSearchingSessions || isSearchingFiles ? "Searching..." : "No commands, files, or sessions found."}
            </div>
          ) : (
            <div className="space-y-1">
              {visibleItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    key={item.id}
                    type="button"
                    onMouseMove={() => {
                      setIsKeyboardNavigating(false);
                      setActiveIndex(index);
                    }}
                    onClick={() => void closeAndRun(item.run)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                      index === boundedActiveIndex
                        ? "bg-primary text-primary-foreground"
                        : !isKeyboardNavigating && "hover:bg-muted"
                    )}
                  >
                    <span className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      index === boundedActiveIndex ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground"
                    )}>
                      <Icon size={16} weight="bold" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className={cn(
                        "block truncate text-xs",
                        index === boundedActiveIndex ? "text-primary-foreground/75" : "text-muted-foreground"
                      )}>
                        {item.subtitle}
                      </span>
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      index === boundedActiveIndex ? "bg-primary-foreground/15 text-primary-foreground/80" : "bg-muted text-muted-foreground"
                    )}>
                      {item.section}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
          <span>Use arrows to navigate, Enter to run, Escape to close</span>
          <span>
            {isLoadingFlows ? "Loading flows" : runningFlowId ? "Running flow" : runError ? runError : isSearchingSessions || isSearchingFiles ? "Searching" : null}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
