"use client";

import { useCallback, useRef, useState } from "react";
import {
  CaretDown,
  CaretRight,
  ChatCircle,
  FolderOpen,
  Robot,
} from "@phosphor-icons/react";

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

type LeftPanelProps = {
  // Sessions
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;

  // Agents
  agents: AgentCatalogItem[];
  onSelectAgent: (agent: AgentCatalogItem) => void;

  // Knowledge (file tree)
  fileNodes: WorkspaceFileNode[];
  activeFilePath?: string | null;
  onSelectFile: (path: string) => void;
  searchQuery: string;
};

function SectionHeader({
  icon: Icon,
  label,
  collapsed,
  onToggle,
}: {
  icon: typeof ChatCircle;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
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
      {collapsed ? (
        <CaretRight size={12} weight="bold" className="text-muted-foreground" />
      ) : (
        <CaretDown size={12} weight="bold" className="text-muted-foreground" />
      )}
    </button>
  );
}

export function LeftPanel({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  agents,
  onSelectAgent,
  fileNodes,
  activeFilePath,
  onSelectFile,
  searchQuery,
}: LeftPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [topRatio, setTopRatio] = useState(3 / 8);
  const [midRatio, setMidRatio] = useState(3 / 8);

  const [topCollapsed, setTopCollapsed] = useState(false);
  const [midCollapsed, setMidCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

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
      {/* Section 1: Chats */}
      <div
        style={sectionStyle(topCollapsed, effectiveTop)}
        className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
      >
        <SectionHeader
          icon={ChatCircle}
          label="Chats"
          collapsed={topCollapsed}
          onToggle={() => setTopCollapsed(prev => !prev)}
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
          icon={FolderOpen}
          label="Knowledge"
          collapsed={midCollapsed}
          onToggle={() => setMidCollapsed(prev => !prev)}
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

      {/* Section 3: Agents */}
      <div
        style={sectionStyle(bottomCollapsed, effectiveBot)}
        className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl"
      >
        <SectionHeader
          icon={Robot}
          label="Agents"
          collapsed={bottomCollapsed}
          onToggle={() => setBottomCollapsed(prev => !prev)}
        />
        <div className="min-h-0 flex-1" style={contentStyle(bottomCollapsed)}>
          <div className="flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
            <AgentsPanel agents={agents} onSelectAgent={onSelectAgent} query={searchQuery} />
          </div>
        </div>
      </div>
    </div>
  );
}
