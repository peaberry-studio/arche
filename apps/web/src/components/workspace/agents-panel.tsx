"use client";

import { useMemo } from "react";
import { Robot } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { AgentCatalogItem } from "@/hooks/use-workspace";

type AgentsPanelProps = {
  agents: AgentCatalogItem[];
  onSelectAgent: (agent: AgentCatalogItem) => void;
  query?: string;
};

const AGENT_AVATAR_CLASS_NAME = "border border-border/50 bg-muted/80 text-muted-foreground";

export function AgentsPanel({ agents, onSelectAgent, query = "" }: AgentsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAgents = useMemo(
    () => agents.filter((agent) => !agent.isPrimary),
    [agents]
  );

  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return visibleAgents;
    return visibleAgents.filter((agent) => {
      const displayName = agent.displayName.toLowerCase();
      const model = agent.model?.toLowerCase() ?? "";
      return displayName.includes(normalizedQuery) || model.includes(normalizedQuery);
    });
  }, [normalizedQuery, visibleAgents]);

  if (visibleAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Robot size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No experts available</p>
      </div>
    );
  }

  if (filteredAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Robot size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No experts found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1.5 scrollbar-none">
      <div className="space-y-0.5">
        {filteredAgents.map((agent) => {
          const initial = agent.displayName.charAt(0).toUpperCase();
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelectAgent(agent)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg pl-1.5 pr-2 py-1.5 text-left text-[13px] transition-colors",
                "text-foreground/80 hover:bg-foreground/5"
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  AGENT_AVATAR_CLASS_NAME
                )}
              >
                {initial}
              </div>
              <span className="flex-1 truncate font-medium">
                {agent.displayName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
