import type { AgentCatalogItem } from "@/hooks/use-workspace";

export type AgentMentionAutocompletePlacement = "top" | "bottom";

export type AgentMentionAutocompletePosition = {
  left: number;
  top: number;
  placement: AgentMentionAutocompletePlacement;
};

export type AgentMentionAutocompleteState = {
  from: number;
  to: number;
  left: number;
  top: number;
  selectedIndex: number;
  suggestions: AgentCatalogItem[];
};

type AgentMentionAutocompletePositionParams = {
  anchorLeft: number;
  anchorTop: number;
  popoverWidth: number;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

const MAX_AGENT_MENTION_SUGGESTIONS = 8;
const AGENT_MENTION_AUTOCOMPLETE_ITEM_HEIGHT_PX = 30;
const AGENT_MENTION_AUTOCOMPLETE_CHROME_HEIGHT_PX = 10;

export const AGENT_MENTION_AUTOCOMPLETE_WIDTH_PX = 320;
export const AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_GAP_PX = 8;
export const AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX = 12;

const TEXTAREA_CARET_STYLE_PROPERTIES = [
  "box-sizing",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-size-adjust",
  "line-height",
  "font-family",
  "letter-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-decoration",
  "text-rendering",
  "text-overflow",
  "text-wrap-mode",
  "text-wrap-style",
  "tab-size",
  "white-space",
  "word-break",
  "word-spacing",
  "scrollbar-gutter",
] as const;

function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeAgentSearchValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getTextareaLineHeight(style: CSSStyleDeclaration): number {
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) return parsed;

  const fontSize = Number.parseFloat(style.fontSize);
  if (Number.isFinite(fontSize)) return fontSize * 1.4;

  return 20;
}

export function getEstimatedAgentMentionAutocompleteHeight(suggestionCount: number): number {
  return (
    AGENT_MENTION_AUTOCOMPLETE_CHROME_HEIGHT_PX +
    suggestionCount * AGENT_MENTION_AUTOCOMPLETE_ITEM_HEIGHT_PX
  );
}

export function buildAgentMentionSuggestions(
  agents: AgentCatalogItem[],
  query: string
): AgentCatalogItem[] {
  const rawQuery = query.trim().toLowerCase();
  const normalizedQuery = normalizeAgentSearchValue(query);

  const scored = agents
    .map((agent) => {
      const id = agent.id.toLowerCase();
      const displayName = agent.displayName.toLowerCase();
      const normalizedId = normalizeAgentSearchValue(agent.id);
      const normalizedDisplayName = normalizeAgentSearchValue(agent.displayName);

      let score = 0;
      if (rawQuery.length > 0) {
        if (id.startsWith(rawQuery)) score = 0;
        else if (displayName.startsWith(rawQuery)) score = 1;
        else if (normalizedId.startsWith(normalizedQuery)) score = 2;
        else if (normalizedDisplayName.startsWith(normalizedQuery)) score = 3;
        else if (id.includes(rawQuery)) score = 4;
        else if (displayName.includes(rawQuery)) score = 5;
        else if (normalizedId.includes(normalizedQuery)) score = 6;
        else if (normalizedDisplayName.includes(normalizedQuery)) score = 7;
        else return null;
      }

      return { agent, score };
    })
    .filter((entry): entry is { agent: AgentCatalogItem; score: number } => entry !== null)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.agent.displayName.localeCompare(right.agent.displayName);
    });

  return scored.slice(0, MAX_AGENT_MENTION_SUGGESTIONS).map((entry) => entry.agent);
}

export function findAgentMentionMatch(
  value: string,
  caretPosition: number
): { from: number; to: number; query: string } | null {
  const clampedCaret = Math.max(0, Math.min(caretPosition, value.length));
  const beforeCaret = value.slice(0, clampedCaret);
  const atIndex = beforeCaret.lastIndexOf("@");

  if (atIndex === -1) return null;
  if (atIndex > 0 && !/\s/.test(beforeCaret[atIndex - 1] ?? "")) {
    return null;
  }

  const beforeQuery = beforeCaret.slice(atIndex + 1);
  if (/\s|@/.test(beforeQuery)) {
    return null;
  }

  const afterCaret = value.slice(clampedCaret).match(/^[^\s@]*/)?.[0] ?? "";
  const query = `${beforeQuery}${afterCaret}`;

  return {
    from: atIndex,
    to: clampedCaret + afterCaret.length,
    query,
  };
}

export function getTextareaCaretPosition(
  textarea: HTMLTextAreaElement,
  position: number
): { left: number; top: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(textarea);

  div.setAttribute("data-agent-mention-caret", "true");
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.pointerEvents = "none";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordBreak = "break-word";
  div.style.overflow = "hidden";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.width = `${textarea.clientWidth}px`;

  for (const property of TEXTAREA_CARET_STYLE_PROPERTIES) {
    div.style.setProperty(property, style.getPropertyValue(property));
  }

  div.textContent = textarea.value.slice(0, position);
  if (div.textContent.endsWith("\n")) {
    div.textContent += "\u200b";
  }

  const span = document.createElement("span");
  span.textContent = textarea.value.slice(position) || "\u200b";
  div.appendChild(span);
  document.body.appendChild(div);

  const coordinates = {
    left: span.offsetLeft - textarea.scrollLeft,
    top: span.offsetTop - textarea.scrollTop + getTextareaLineHeight(style),
  };

  document.body.removeChild(div);
  return coordinates;
}

export function getAgentMentionAutocompletePosition({
  anchorLeft,
  anchorTop,
  popoverWidth,
  popoverHeight,
  viewportWidth,
  viewportHeight,
}: AgentMentionAutocompletePositionParams): AgentMentionAutocompletePosition {
  const left = clamp(
    anchorLeft,
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX,
    viewportWidth - popoverWidth - AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX
  );

  const availableAbove =
    anchorTop -
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_GAP_PX -
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX;
  const availableBelow =
    viewportHeight -
    anchorTop -
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_GAP_PX -
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX;

  const placement: AgentMentionAutocompletePlacement =
    availableBelow >= popoverHeight
      ? "bottom"
      : availableAbove >= popoverHeight
        ? "top"
        : availableBelow >= availableAbove
          ? "bottom"
          : "top";

  const rawTop =
    placement === "bottom"
      ? anchorTop + AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_GAP_PX
      : anchorTop - popoverHeight - AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_GAP_PX;

  const top = clamp(
    rawTop,
    AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX,
    viewportHeight - popoverHeight - AGENT_MENTION_AUTOCOMPLETE_VIEWPORT_PADDING_PX
  );

  return { left, top, placement };
}
