"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ChatCircle,
  Cpu,
  Database,
  File,
  GearSix,
  Lightning,
  Moon,
  Palette,
  Plugs,
  Sidebar,
  Sparkle,
} from "@phosphor-icons/react";

import { listSessionsAction } from "@/actions/opencode";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useAutopilotTaskRunner } from "@/hooks/use-autopilot-task-runner";
import type { WorkspaceSession } from "@/lib/opencode/types";
import { isAutopilotSession } from "@/lib/workspace-session-utils";
import type { WorkspaceThemeId } from "@/lib/workspace-theme";
import { cn } from "@/lib/utils";

import type { WorkspaceMode } from "./workspace-mode-toggle";

type WorkspaceCommandPaletteProps = {
  slug: string;
  open: boolean;
  hideTasks: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSession: () => Promise<void> | void;
  onModeChange: (mode: WorkspaceMode) => void;
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

function matchesQuery(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.subtitle} ${item.section} ${item.keywords ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function WorkspaceCommandPalette({
  slug,
  open,
  hideTasks,
  onOpenChange,
  onCreateSession,
  onModeChange,
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
  const { themes, themeId, setThemeId, toggleDark } = useWorkspaceTheme();
  const {
    tasks,
    isLoadingTasks,
    runningTaskId,
    runError,
    loadTasks,
    runTask,
  } = useAutopilotTaskRunner({ slug, onRunTaskComplete: onRefreshSessions });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (nextOpen) return;
      setQuery("");
      setActiveIndex(0);
      setIsKeyboardNavigating(false);
      setSessionResults([]);
      setIsSearchingSessions(false);
    },
    [onOpenChange]
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
    requestAnimationFrame(() => itemRefs.current[0]?.scrollIntoView({ block: "nearest" }));
    if (value.trim()) {
      setIsSearchingSessions(true);
      return;
    }
    setSessionResults([]);
    setIsSearchingSessions(false);
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    if (!hideTasks) {
      void loadTasks();
    }
  }, [hideTasks, loadTasks, open]);

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void listSessionsAction(slug, {
        limit: SESSION_SEARCH_SCAN_LIMIT,
        query: trimmedQuery,
        rootsOnly: true,
      }).then((result) => {
        if (cancelled) return;
        setSessionResults(result.ok ? (result.sessions ?? []).slice(0, SESSION_SEARCH_RESULT_LIMIT) : []);
        setIsSearchingSessions(false);
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, query, slug]);

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

    if (!hideTasks) {
      items.splice(1, 0, {
        id: "mode-tasks",
        title: "Go to Tasks mode",
        subtitle: "Show autopilot task runs",
        section: "Modes",
        icon: Lightning,
        keywords: "autopilot runs",
        run: () => onModeChange("tasks"),
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
  }, [hideTasks, onCreateSession, onModeChange, onNavigateConnectors, onNavigateProviders, onNavigateSettings, onToggleLeftPanel, onToggleRightPanel, setThemeId, themeId, themes, toggleDark]);

  const taskItems = useMemo<PaletteItem[]>(() => {
    if (hideTasks) return [];
    return tasks.map((task) => ({
      id: `run-task-${task.id}`,
      title: `Run task: ${task.name}`,
      subtitle: task.prompt,
      section: "Tasks",
      icon: Lightning,
      keywords: "autopilot",
      run: async () => {
        onModeChange("tasks");
        await runTask(task.id);
      },
    }));
  }, [hideTasks, onModeChange, runTask, tasks]);

  const sessionItems = useMemo<PaletteItem[]>(() => {
    return sessionResults
      .filter((session) => !hideTasks || !isAutopilotSession(session))
      .map((session) => {
        const isTaskRun = isAutopilotSession(session);
        return {
          id: `session-${session.id}`,
          title: session.title,
          subtitle: isTaskRun
            ? `Task run${session.autopilot?.taskName ? `: ${session.autopilot.taskName}` : ""}`
            : "Chat session",
          section: isTaskRun ? "Task runs" : "Chats",
          icon: isTaskRun ? Lightning : ChatCircle,
          keywords: session.autopilot?.taskName,
          run: () => onSelectSession(session.id, isTaskRun ? "tasks" : "chat"),
        };
      });
  }, [hideTasks, onSelectSession, sessionResults]);

  const visibleItems = useMemo(() => {
    const trimmedQuery = query.trim();
    return [...baseItems, ...taskItems].filter((item) => matchesQuery(item, trimmedQuery)).concat(sessionItems);
  }, [baseItems, query, sessionItems, taskItems]);

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
          Search workspace commands, chats, task runs, and settings.
        </DialogDescription>
        <div className="border-b border-border/50 p-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, chats, tasks..."
            className="h-11 border-0 bg-muted/40 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="scrollbar-custom max-h-[min(28rem,60vh)] overflow-y-auto p-2">
          {visibleItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {isSearchingSessions ? "Searching sessions..." : "No commands or sessions found."}
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
            {isLoadingTasks ? "Loading tasks" : runningTaskId ? "Running task" : runError ? runError : isSearchingSessions ? "Searching sessions" : null}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
