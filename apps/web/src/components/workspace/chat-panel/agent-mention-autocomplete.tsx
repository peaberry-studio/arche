import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AgentCatalogItem } from "@/hooks/use-workspace";
import {
  AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX,
  AGENT_MENTION_AUTOCOMPLETE_WIDTH_PX,
  getAgentMentionAutocompletePosition,
  getEstimatedAgentMentionAutocompleteHeight,
  type AgentMentionAutocompletePosition,
  type AgentMentionAutocompleteState,
} from "@/lib/workspace-agent-mentions";
import { cn } from "@/lib/utils";

type AgentMentionAutocompleteProps = {
  autocomplete: AgentMentionAutocompleteState | null;
  onSelect: (agent: AgentCatalogItem, range: { from: number; to: number }) => void;
};

export function AgentMentionAutocomplete({
  autocomplete,
  onSelect,
}: AgentMentionAutocompleteProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<
    | (AgentMentionAutocompletePosition & {
        anchorLeft: number;
        anchorTop: number;
        from: number;
        suggestionCount: number;
        to: number;
        viewportHeight: number;
        viewportWidth: number;
      })
    | null
  >(null);

  useLayoutEffect(() => {
    if (!autocomplete || typeof window === "undefined") return;

    const popover = popoverRef.current;
    if (!popover) return;

    const rect = popover.getBoundingClientRect();
    const nextPosition = getAgentMentionAutocompletePosition({
      anchorLeft: autocomplete.left,
      anchorTop: autocomplete.top,
      popoverWidth: rect.width,
      popoverHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    setPosition({
      ...nextPosition,
      anchorLeft: autocomplete.left,
      anchorTop: autocomplete.top,
      from: autocomplete.from,
      suggestionCount: autocomplete.suggestions.length,
      to: autocomplete.to,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    });
  }, [autocomplete]);

  if (!autocomplete || typeof document === "undefined") return null;

  const fallbackPosition = getAgentMentionAutocompletePosition({
    anchorLeft: autocomplete.left,
    anchorTop: autocomplete.top,
    popoverWidth: Math.min(
      AGENT_MENTION_AUTOCOMPLETE_WIDTH_PX,
      window.innerWidth - AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX * 2
    ),
    popoverHeight: Math.min(
      getEstimatedAgentMentionAutocompleteHeight(autocomplete.suggestions.length),
      window.innerHeight - AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX * 2
    ),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });

  const isPositionCurrent =
    position !== null &&
    position.anchorLeft === autocomplete.left &&
    position.anchorTop === autocomplete.top &&
    position.from === autocomplete.from &&
    position.suggestionCount === autocomplete.suggestions.length &&
    position.to === autocomplete.to &&
    position.viewportHeight === window.innerHeight &&
    position.viewportWidth === window.innerWidth;
  const resolvedPosition = isPositionCurrent ? position : fallbackPosition;

  return createPortal(
    <div
      className="pointer-events-none z-50"
      role="presentation"
      style={{
        position: "fixed",
        left: resolvedPosition.left,
        top: resolvedPosition.top,
        visibility: isPositionCurrent ? "visible" : "hidden",
      }}
    >
      <div
        ref={popoverRef}
        className="pointer-events-auto overflow-y-auto rounded-md border border-white/10 bg-background/95 p-1 shadow-lg backdrop-blur-sm"
        style={{
          width: `min(${AGENT_MENTION_AUTOCOMPLETE_WIDTH_PX}px, calc(100vw - ${AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX * 2}px))`,
          maxHeight: `calc(100vh - ${AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX * 2}px)`,
        }}
      >
        {autocomplete.suggestions.map((agent, index) => (
          <button
            key={agent.id}
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-xs",
              index === autocomplete.selectedIndex
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(agent, {
                from: autocomplete.from,
                to: autocomplete.to,
              });
            }}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{agent.displayName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">@{agent.id}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
