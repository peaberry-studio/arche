"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { File, TreeStructure } from "@phosphor-icons/react";

import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useWorkspaceRuntime } from "@/contexts/workspace-runtime-context";
import { useExploreWorkspace } from "@/hooks/use-explore-workspace";
import { useViewportWidth } from "@/hooks/use-viewport-width";
import type { KnowledgeGraphAgentSource } from "@/lib/kb-graph";
import { cn } from "@/lib/utils";
import {
  parseWorkspaceLayoutState,
  persistWorkspacePanelState,
  readWorkspacePanelState,
} from "@/lib/workspace-panel-state";

import { CuratorDialog } from "./curator-dialog";
import { InspectorPanel } from "./inspector-panel";
import { KnowledgeEmptyState } from "./knowledge-empty-state";
import {
  KnowledgeNavigationPanel,
  type KnowledgeNavigationView,
} from "./knowledge-navigation-panel";
import { MIN_LEFT_PX, MIN_RIGHT_PX, WorkspacePanes } from "./workspace-panes";
import { WorkspaceConnectingBanner } from "./workspace-startup-screens";

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
  // Instance startup state comes from the layout-level runtime provider so
  // chat ↔ explore navigation does not re-run the startup waterfall.
  const {
    connection,
    curatorOpen,
    instanceStatus,
    instanceError,
    isConnected,
    setCuratorOpen,
    setKnowledgePendingCount,
    setKnowledgePublishCount,
  } = useWorkspaceRuntime();

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
  const [navCollapsed, setNavCollapsed] = useState<boolean>(
    () =>
      readWorkspacePanelState(layoutStorageKey, layoutCookieName, parseWorkspaceLayoutState)
        ?.leftCollapsed === true
  );

  useEffect(() => {
    persistWorkspacePanelState(layoutStorageKey, layoutCookieName, { leftCollapsed: navCollapsed });
  }, [layoutCookieName, layoutStorageKey, navCollapsed]);

  const handleToggleNav = useCallback(() => {
    setNavCollapsed((previous) => !previous);
  }, []);

  const [navWidth, setNavWidth] = useState<number>(() =>
    typeof window === "undefined"
      ? MIN_LEFT_PX
      : Math.min(
          Math.max(window.innerWidth * DEFAULT_LEFT_RATIO, MIN_LEFT_PX),
          window.innerWidth - MIN_CENTER_PX
        )
  );
  const viewportWidth = useViewportWidth();
  const [mobileView, setMobileView] = useState<ExploreMobileView>("tree");
  const isCompactLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const wasCompactLayoutRef = useRef(isCompactLayout);

  useEffect(() => {
    if (!wasCompactLayoutRef.current && isCompactLayout) {
      setMobileView("tree");
    }

    wasCompactLayoutRef.current = isCompactLayout;
  }, [isCompactLayout]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleResizeNav = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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
      const maxNav = Math.max(MIN_LEFT_PX, rect.width - MIN_CENTER_PX);
      const nextWidth = Math.min(Math.max(rect.right - moveEvent.clientX, MIN_LEFT_PX), maxNav);
      setNavWidth(nextWidth);
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
  // The chrome stays mounted while the instance is starting / connecting; the
  // editor center shows an in-pane banner instead of a full-viewport gate.
  const isReady = instanceStatus === "running" && isConnected;

  const connectingBanner = (
    <WorkspaceConnectingBanner
      connection={connection}
      instanceError={instanceError}
      instanceStatus={instanceStatus}
    />
  );

  const navigationPanelElement = (
    <KnowledgeNavigationPanel
      activeFilePath={workspace.activeFilePath}
      agentSources={knowledgeAgentSources}
      collapsed={!isCompactLayout && navCollapsed}
      dockedSide="right"
      fileNodes={workspace.fileTree}
      onDownloadFile={workspace.onDownloadFile}
      onExportFileDocx={workspace.onExportFileDocx}
      onExportFilePdf={workspace.onExportFilePdf}
      onOpenFile={(path) => {
        void workspace.onOpenFile(path)
      }}
      onToggleCollapsed={isCompactLayout ? undefined : handleToggleNav}
      openFiles={workspace.openFiles}
      readFile={workspace.readFile}
      reloadKey={0}
      view={knowledgeNavView}
      onViewChange={setKnowledgeNavView}
    />
  );

  const editorPanelElement = !isReady ? connectingBanner : workspace.openFiles.length === 0 ? (
    <KnowledgeEmptyState />
  ) : (
    <InspectorPanel
      workspaceAgentEnabled={workspaceAgentEnabled}
      rightCollapsed={false}
      onToggleRight={() => undefined}
      hideCollapseButton
      openFiles={workspace.openFiles}
      activeFilePath={workspace.activeFilePath}
      onSelectFile={workspace.onSelectFile}
      onCloseFile={workspace.onCloseFile}
      diffs={workspace.diffs}
      onOpenFile={(path) => {
        void workspace.onOpenFile(path)
      }}
      internalLinkPaths={workspace.markdownFilePaths}
      onReloadFile={workspace.onReloadFile}
      onSaveFile={workspaceAgentEnabled ? workspace.onSaveFile : undefined}
    />
  );

  const isTreeActive = mobileView === "tree";
  const isEditorActive = mobileView === "editor";

  const handleKnowledgeReviewApplied = useCallback(() => {
    void workspace.refreshDiffs();
    void workspace.refreshFiles();
  }, [workspace]);

  // Pending publish count feeds the sidebar badge, so it must track every
  // diffs refresh (apply, publish, discard, conflict resolution).
  useEffect(() => {
    setKnowledgePublishCount(workspace.diffs.length);
  }, [setKnowledgePublishCount, workspace.diffs]);

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && "desktop-no-select",
        darkModeClasses,
        themeClassName,
      )}
    >
      <CuratorDialog
        open={curatorOpen}
        onOpenChange={setCuratorOpen}
        slug={slug}
        workspaceAgentEnabled={workspaceAgentEnabled}
        diffs={workspace.diffs}
        isLoadingDiffs={workspace.isLoadingDiffs}
        diffsError={workspace.diffsError}
        onOpenFile={(path) => {
          void workspace.onOpenFile(path)
        }}
        internalLinkPaths={workspace.markdownFilePaths}
        onDiscardFileChanges={workspaceAgentEnabled ? workspace.onDiscardFileChanges : undefined}
        onPublish={workspaceAgentEnabled ? workspace.onPublish : undefined}
        onResolveConflict={workspaceAgentEnabled ? workspace.onResolveConflict : undefined}
        onKnowledgeReviewApplied={handleKnowledgeReviewApplied}
        onProposalCountChange={setKnowledgePendingCount}
      />
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
              aria-label="Knowledge Base sections"
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
            hasLeftPanel={false}
            rightCollapsed={navCollapsed}
            rightWidth={navWidth}
            minRightWidth={MIN_LEFT_PX}
            minCenterWidth={MIN_CENTER_PX}
            isDragging={isDragging}
            hasRightPanel
            macDesktopWindowInset={false}
            containerRef={containerRef}
            centerElement={editorPanelElement}
            rightElement={navigationPanelElement}
            onResizeRight={handleResizeNav}
          />
        )}
      </div>
    </div>
  );
}
