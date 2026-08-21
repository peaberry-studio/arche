"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLineLeft, File, TreeStructure } from "@phosphor-icons/react";

import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useExploreWorkspace } from "@/hooks/use-explore-workspace";
import { useInstanceStartup } from "@/hooks/use-instance-startup";
import type { KnowledgeGraphAgentSource } from "@/lib/kb-graph";
import { cn } from "@/lib/utils";
import {
  parseWorkspaceLayoutState,
  persistWorkspacePanelState,
  readWorkspacePanelState,
} from "@/lib/workspace-panel-state";

import { InspectorPanel } from "./inspector-panel";
import { KnowledgeEmptyState } from "./knowledge-empty-state";
import {
  KnowledgeNavigationPanel,
  type KnowledgeNavigationView,
} from "./knowledge-navigation-panel";
import { MIN_LEFT_PX, MIN_RIGHT_PX, WorkspacePanes } from "./workspace-panes";
import {
  WorkspaceConnectingScreen,
  WorkspaceStartupScreen,
} from "./workspace-startup-screens";

type ExploreShellProps = {
  slug: string;
  persistenceScope: string;
  initialFilePath?: string | null;
  knowledgeAgentSources?: KnowledgeGraphAgentSource[];
  macDesktopWindowInset?: boolean;
  workspaceAgentEnabled?: boolean;
  reaperEnabled?: boolean;
};

const MIN_CENTER_PX = 360;
const PANEL_GAP = 0;
const MOBILE_LAYOUT_BREAKPOINT =
  MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX + 2 * PANEL_GAP + 48;
const DEFAULT_LEFT_RATIO = 0.35;

type ExploreMobileView = "tree" | "editor";

export function ExploreShell({
  slug,
  persistenceScope,
  initialFilePath = null,
  knowledgeAgentSources = [],
  macDesktopWindowInset = false,
  workspaceAgentEnabled = true,
  reaperEnabled = true,
}: ExploreShellProps) {
  const router = useRouter();

  // Instance startup state
  const { instanceStatus, instanceError } = useInstanceStartup(slug);

  const workspace = useExploreWorkspace({
    slug,
    storageScope: persistenceScope,
    initialFilePath,
    enabled: instanceStatus === "running",
    workspaceAgentEnabled,
    reaperEnabled,
  });

  const [knowledgeNavView, setKnowledgeNavView] = useState<KnowledgeNavigationView>("tree");

  const layoutStorageKey = `arche.explore.${persistenceScope}.layout`;
  const layoutCookieName = `arche-explore-layout-${persistenceScope}`;
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(
    () =>
      readWorkspacePanelState(layoutStorageKey, layoutCookieName, parseWorkspaceLayoutState)
        ?.leftCollapsed === true
  );

  useEffect(() => {
    persistWorkspacePanelState(layoutStorageKey, layoutCookieName, { leftCollapsed });
  }, [layoutCookieName, layoutStorageKey, leftCollapsed]);

  const handleToggleLeft = useCallback(() => {
    setLeftCollapsed((previous) => !previous);
  }, []);

  const [leftWidth, setLeftWidth] = useState<number>(() =>
    typeof window === "undefined"
      ? MIN_LEFT_PX
      : Math.min(
          Math.max(window.innerWidth * DEFAULT_LEFT_RATIO, MIN_LEFT_PX),
          window.innerWidth - MIN_RIGHT_PX - MIN_CENTER_PX
        )
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX : window.innerWidth
  );
  const [mobileView, setMobileView] = useState<ExploreMobileView>("tree");
  const isCompactLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const wasCompactLayoutRef = useRef(isCompactLayout);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      const nextWidth = window.innerWidth;
      const nextCompactState = nextWidth < MOBILE_LAYOUT_BREAKPOINT;

      setViewportWidth(nextWidth);

      if (!wasCompactLayoutRef.current && nextCompactState) {
        setMobileView("tree");
      }

      wasCompactLayoutRef.current = nextCompactState;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

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
      const maxLeft = Math.max(MIN_LEFT_PX, rect.width - MIN_RIGHT_PX - MIN_CENTER_PX);
      const nextWidth = Math.min(Math.max(moveEvent.clientX - rect.left, MIN_LEFT_PX), maxLeft);
      setLeftWidth(nextWidth);
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
  }, []);

  // Get theme from context
  const { themeId, isDark } = useWorkspaceTheme();
  const darkModeClasses = isDark ? "dark" : "";
  const themeClassName = `theme-${themeId}`;

  // Loading screen while instance is starting
  if (instanceStatus !== "running") {
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

  const navigationPanelElement = (
    <KnowledgeNavigationPanel
      activeFilePath={workspace.activeFilePath}
      agentSources={knowledgeAgentSources}
      collapsed={!isCompactLayout && leftCollapsed}
      fileNodes={workspace.fileTree}
      onDownloadFile={workspace.onDownloadFile}
      onExportFileDocx={workspace.onExportFileDocx}
      onExportFilePdf={workspace.onExportFilePdf}
      onOpenFile={(path) => {
        void workspace.onOpenFile(path)
      }}
      onToggleCollapsed={isCompactLayout ? undefined : handleToggleLeft}
      openFiles={workspace.openFiles}
      readFile={workspace.readFile}
      reloadKey={0}
      view={knowledgeNavView}
      onViewChange={setKnowledgeNavView}
    />
  );

  const editorPanelElement = workspace.openFiles.length === 0 ? (
    <KnowledgeEmptyState />
  ) : (
    <InspectorPanel
      slug={slug}
      panelMode="files"
      workspaceAgentEnabled={workspaceAgentEnabled}
      onTabChange={() => undefined}
      rightCollapsed={false}
      onToggleRight={() => undefined}
      hideCollapseButton
      openFiles={workspace.openFiles}
      activeFilePath={workspace.activeFilePath}
      onSelectFile={workspace.onSelectFile}
      onCloseFile={workspace.onCloseFile}
      diffs={workspace.diffs}
      isLoadingDiffs={workspace.isLoadingDiffs}
      diffsError={workspace.diffsError}
      onOpenFile={(path) => {
        void workspace.onOpenFile(path)
      }}
      internalLinkPaths={workspace.markdownFilePaths}
      onReloadFile={workspace.onReloadFile}
      onSaveFile={workspaceAgentEnabled ? workspace.onSaveFile : undefined}
      onDiscardFileChanges={workspaceAgentEnabled ? workspace.onDiscardFileChanges : undefined}
      onPublish={workspaceAgentEnabled ? workspace.onPublish : undefined}
      onResolveConflict={workspaceAgentEnabled ? workspace.onResolveConflict : undefined}
    />
  );

  const isTreeActive = mobileView === "tree";
  const isEditorActive = mobileView === "editor";

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && "desktop-no-select",
        darkModeClasses,
        themeClassName,
      )}
    >
      <header
        className={cn(
          "flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3",
          macDesktopWindowInset && "desktop-titlebar-drag pl-[88px]"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="type-display truncate text-base font-semibold tracking-tight">Arche</span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="truncate text-sm font-medium text-card-foreground">Explore</span>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/w/${slug}`)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            macDesktopWindowInset && "desktop-titlebar-no-drag"
          )}
        >
          <ArrowLineLeft size={13} weight="bold" />
          Back to Sessions
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {isCompactLayout ? (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                className="absolute inset-0 min-h-0 overflow-hidden px-3 pb-3 pt-2"
                hidden={!isTreeActive}
                aria-hidden={!isTreeActive}
              >
                {navigationPanelElement}
              </div>
              <div
                className="absolute inset-0 min-h-0 overflow-hidden px-3 pb-3 pt-2"
                hidden={!isEditorActive}
                aria-hidden={!isEditorActive}
              >
                {editorPanelElement}
              </div>
            </div>

            <nav
              className="grid shrink-0 grid-cols-2 border-t border-border/40 bg-background"
              style={{
                minHeight: "calc(3.5rem + env(safe-area-inset-bottom, 0px))",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }}
              aria-label="Explore sections"
            >
              <button
                type="button"
                onClick={() => setMobileView("tree")}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                  isTreeActive
                    ? "text-foreground"
                    : "text-muted-foreground active:text-foreground"
                )}
                aria-label={isTreeActive ? "Close file tree" : "Open file tree"}
                aria-pressed={isTreeActive}
              >
                <TreeStructure size={22} weight={isTreeActive ? "fill" : "regular"} />
                <span>Tree</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileView("editor")}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                  isEditorActive
                    ? "text-foreground"
                    : "text-muted-foreground active:text-foreground"
                )}
                aria-label={isEditorActive ? "Close file viewer" : "Open file viewer"}
                aria-pressed={isEditorActive}
              >
                <File size={22} weight={isEditorActive ? "fill" : "regular"} />
                <span>Viewer</span>
              </button>
            </nav>
          </>
        ) : (
          <WorkspacePanes
            leftCollapsed={leftCollapsed}
            leftWidth={leftWidth}
            rightCollapsed={true}
            rightWidth={MIN_RIGHT_PX}
            minCenterWidth={MIN_CENTER_PX}
            isDragging={isDragging}
            hasRightPanel={false}
            macDesktopWindowInset={false}
            containerRef={containerRef}
            leftElement={navigationPanelElement}
            centerElement={editorPanelElement}
            rightElement={null}
            onResizeLeft={handleResizeLeft}
            onResizeRight={() => undefined}
          />
        )}
      </div>
    </div>
  );
}
