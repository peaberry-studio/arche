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

const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-violet-500/20 text-violet-400",
  "bg-amber-500/20 text-amber-400",
  "bg-rose-500/20 text-rose-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-pink-500/20 text-pink-400",
  "bg-teal-500/20 text-teal-400",
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function AgentsPanel({ agents, onSelectAgent, query = "" }: AgentsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return agents;
    return agents.filter((agent) => {
      const displayName = agent.displayName.toLowerCase();
      const model = agent.model?.toLowerCase() ?? "";
      return displayName.includes(normalizedQuery) || model.includes(normalizedQuery);
    });
  }, [agents, normalizedQuery]);

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Robot size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No agents available</p>
      </div>
    );
  }

  if (filteredAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
        <Robot size={24} weight="bold" className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">No agents found</p>
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
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                "text-foreground/80 hover:bg-foreground/5"
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  getAvatarColor(agent.id)
                )}
              >
                {initial}
              </div>
              <span className="flex-1 truncate font-medium">
                {agent.displayName}
              </span>
              {agent.isPrimary && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Primary
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
