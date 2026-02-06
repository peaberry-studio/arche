"use client";

import { Robot } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { AgentCatalogItem } from "@/hooks/use-workspace";

type AgentsPanelProps = {
  agents: AgentCatalogItem[];
  onSelectAgent: (agent: AgentCatalogItem) => void;
};

export function AgentsPanel({ agents, onSelectAgent }: AgentsPanelProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Robot size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No agents available</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2 scrollbar-none">
      <div className="space-y-0.5">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelectAgent(agent)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors",
              "text-foreground/80 hover:bg-foreground/5"
            )}
          >
            <Robot
              size={16}
              weight="bold"
              className="shrink-0 text-muted-foreground"
            />
            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
              <span className="truncate font-medium">{agent.displayName}</span>
              {agent.model && (
                <span className="truncate text-[11px] text-muted-foreground/60">
                  {agent.model}
                </span>
              )}
            </div>
            {agent.isPrimary && (
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Primary
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
