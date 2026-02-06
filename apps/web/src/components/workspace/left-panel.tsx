"use client";

import { useState } from "react";
import {
  ChatCircle,
  FolderOpen,
  Plus,
  Robot,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";
import type { AgentCatalogItem } from "@/hooks/use-workspace";

import { AgentsPanel } from "./agents-panel";
import { FileTreePanel } from "./file-tree-panel";
import { SessionsPanel } from "./sessions-panel";

type LeftTab = "sessions" | "agents" | "knowledge";

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
};

const TABS: { id: LeftTab; label: string; icon: typeof ChatCircle }[] = [
  { id: "sessions", label: "Sessions", icon: ChatCircle },
  { id: "agents", label: "Agents", icon: Robot },
  { id: "knowledge", label: "Knowledge", icon: FolderOpen },
];

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
}: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>("sessions");

  return (
    <div className="flex h-full flex-col text-card-foreground">
      {/* Tab bar */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 pl-2 pr-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <Icon
                size={14}
                weight={activeTab === tab.id ? "fill" : "bold"}
              />
              {tab.label}
            </button>
          );
        })}

        {/* Contextual action button */}
        <div className="ml-auto">
          {activeTab === "sessions" && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="New session"
              onClick={onCreateSession}
            >
              <Plus size={16} weight="bold" />
            </Button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {activeTab === "sessions" && (
          <SessionsPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
          />
        )}
        {activeTab === "agents" && (
          <AgentsPanel agents={agents} onSelectAgent={onSelectAgent} />
        )}
        {activeTab === "knowledge" && (
          <FileTreePanel
            nodes={fileNodes}
            activePath={activeFilePath}
            onSelect={onSelectFile}
            hideHeader
          />
        )}
      </div>
    </div>
  );
}
