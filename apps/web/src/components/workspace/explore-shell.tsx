"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
import { MIN_CENTER_PX, MIN_LEFT_PX, WorkspacePanes, WORKSPACE_COMPACT_PANE_BREAKPOINT } from "./workspace-panes";
import { WorkspaceConnectingBanner } from "./workspace-startup-screens";

type ExploreShellProps = {
  slug: string;
  persistenceScope: string;
  initialFilePath?: string | null;
  knowledgeAgentSources?: KnowledgeGraphAgentSource[];
  macDesktopWindowInset?: boolean;
  workspaceAgentEnabled?: boolean;
};

const MOBILE_LAYOUT_BREAKPOINT = WORKSPACE_COMPACT_PANE_BREAKPOINT;
const DEFAULT_LEFT_RATIO = 0.35;

type ExploreMobileView = "tree" | "editor";

export function ExploreShell({
  slug,
  persistenceScope,
  initialFilePath = null,
  knowledgeAgentSources = [],
  macDesktopWindowInset = false,
  workspaceAgentEnabled = true,
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (workspace.activeFilePath) {
      params.set("path", workspace.activeFilePath);
    } else {
      params.delete("path");
    }

    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      query ? `/w/${slug}/explore?${query}` : `/w/${slug}/explore`,
    );
  }, [slug, workspace.activeFilePath]);

  const handleToggleNav = useCallback(() => {
    setNavCollapsed((previous) => !previous);
  }, []);

  const [navWidth, setNavWidth] = useState<number>(() =>
    typeof window === "undefined"
      ? MIN_LEFT_PX
      : Math.min(
          Math.max(window.innerWidth * DEFAULT_LEFT_RATIO, MIN_LEFT_PX),
          window.innerWidth - MIN_CENTER_PX,
        )
  );
  const viewportWidth = useViewportWidth();
  const [mobileView, setMobileView] = useState<ExploreMobileView>(
    initialFilePath ? "editor" : "tree"
  );
  const isCompactLayout = viewportWidth < MOBILE_LAYOUT_BREAKPOINT;
  const wasCompactLayoutRef = useRef(isCompactLayout);

  useEffect(() => {
    if (!wasCompactLayoutRef.current && isCompactLayout) {
      setMobileView(workspace.activeFilePath ? "editor" : "tree");
    }

    wasCompactLayoutRef.current = isCompactLayout;
  }, [isCompactLayout, workspace.activeFilePath]);

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

  const handleOpenFile = useCallback((path: string) => {
    void workspace.onOpenFile(path);
    if (isCompactLayout) setMobileView("editor");
  }, [isCompactLayout, workspace]);

  const handleCloseFile = useCallback((path: string) => {
    const remaining = workspace.openFiles.filter((file) => file.path !== path);
    workspace.onCloseFile(path);
    if (isCompactLayout && remaining.length === 0) {
      setMobileView("tree");
    }
  }, [isCompactLayout, workspace]);

  const handleBackToFiles = useCallback(() => {
    setMobileView("tree");
  }, []);

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
      onOpenFile={handleOpenFile}
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
      onCloseFile={handleCloseFile}
      diffs={workspace.diffs}
      onOpenFile={handleOpenFile}
      internalLinkPaths={workspace.markdownFilePaths}
      onReloadFile={workspace.onReloadFile}
      onSaveFile={workspaceAgentEnabled ? workspace.onSaveFile : undefined}
      onBack={isCompactLayout ? handleBackToFiles : undefined}
    />
  );

  const isTreeActive = mobileView === "tree";
  const isEditorActive = mobileView === "editor";

  const handleKnowledgeReviewApplied = useCallback(() => {
    void workspace.refreshDiffs();
    void workspace.refreshFiles();
  }, [workspace]);

  // Manual edits count feeds the sidebar badge, so it must track every
  // diffs refresh (apply, publish, discard, conflict resolution).
  useEffect(() => {
    setKnowledgePublishCount(workspace.diffs.length);
  }, [setKnowledgePublishCount, workspace.diffs]);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground',
        macDesktopWindowInset && "desktop-no-select",
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
        onOpenFile={handleOpenFile}
        internalLinkPaths={workspace.markdownFilePaths}
        onDiscardFileChanges={workspaceAgentEnabled ? workspace.onDiscardFileChanges : undefined}
        onPublish={workspaceAgentEnabled ? workspace.onPublish : undefined}
        onResolveConflict={workspaceAgentEnabled ? workspace.onResolveConflict : undefined}
        onKnowledgeReviewApplied={handleKnowledgeReviewApplied}
        onProposalCountChange={setKnowledgePendingCount}
      />
      <div className="flex min-h-0 flex-1">
        {isCompactLayout ? (
          <div className="relative min-h-0 flex-1">
            <div
              className="absolute inset-0 min-h-0 overflow-hidden"
              style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
              hidden={!isTreeActive}
              aria-hidden={!isTreeActive}
            >
              {navigationPanelElement}
            </div>
            <div
              className="absolute inset-0 min-h-0 overflow-hidden"
              style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
              hidden={!isEditorActive}
              aria-hidden={!isEditorActive}
            >
              {editorPanelElement}
            </div>
          </div>
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
