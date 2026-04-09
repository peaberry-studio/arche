import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
} from "react";

import type { AgentCatalogItem } from "@/hooks/use-workspace";
import {
  buildAgentMentionSuggestions,
  findAgentMentionMatch,
  getTextareaCaretPosition,
  type AgentMentionAutocompleteState,
} from "@/lib/workspace-agent-mentions";

type TextSelectionRange = {
  start: number;
  end: number;
};

type UseAgentMentionAutocompleteOptions = {
  agents: AgentCatalogItem[];
  inputValue: string;
  isReadOnly: boolean;
  setInputValue: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

type UseAgentMentionAutocompleteResult = {
  agentMentionAutocomplete: AgentMentionAutocompleteState | null;
  clearAgentMentionAutocomplete: () => void;
  handleInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handleMentionKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleTextareaBlur: () => void;
  handleTextareaKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  handleTextareaSelectionChange: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  insertComposerText: (text: string, range?: { from: number; to: number }) => void;
  onAgentMentionSelect: (agent: AgentCatalogItem, range: { from: number; to: number }) => void;
};

export function useAgentMentionAutocomplete({
  agents,
  inputValue,
  isReadOnly,
  setInputValue,
  textareaRef,
}: UseAgentMentionAutocompleteOptions): UseAgentMentionAutocompleteResult {
  const [agentMentionAutocomplete, setAgentMentionAutocomplete] =
    useState<AgentMentionAutocompleteState | null>(null);
  const selectionRangeRef = useRef<TextSelectionRange>({ start: 0, end: 0 });
  const pendingSelectionRangeRef = useRef<TextSelectionRange | null>(null);

  const mentionableAgents = useMemo(
    () => agents.filter((agent) => !agent.isPrimary),
    [agents]
  );

  const syncTextareaSelection = useCallback(
    (textarea?: HTMLTextAreaElement | null) => {
      const target = textarea ?? textareaRef.current;
      if (!target) return;

      selectionRangeRef.current = {
        start: target.selectionStart ?? target.value.length,
        end: target.selectionEnd ?? target.value.length,
      };
    },
    [textareaRef]
  );

  const updateAgentMentionAutocomplete = useCallback(
    (value: string, selection: TextSelectionRange) => {
      if (isReadOnly || mentionableAgents.length === 0 || selection.start !== selection.end) {
        setAgentMentionAutocomplete(null);
        return;
      }

      const match = findAgentMentionMatch(value, selection.end);
      if (!match) {
        setAgentMentionAutocomplete(null);
        return;
      }

      const suggestions = buildAgentMentionSuggestions(mentionableAgents, match.query);
      if (suggestions.length === 0) {
        setAgentMentionAutocomplete(null);
        return;
      }

      const textarea = textareaRef.current;
      if (!textarea) {
        setAgentMentionAutocomplete(null);
        return;
      }

      const textareaRect = textarea.getBoundingClientRect();
      const caret = getTextareaCaretPosition(textarea, match.to);

      setAgentMentionAutocomplete((previous) => ({
        from: match.from,
        to: match.to,
        suggestions,
        left: textareaRect.left + caret.left,
        top: textareaRect.top + caret.top,
        selectedIndex:
          previous &&
          previous.from === match.from &&
          previous.to === match.to &&
          previous.selectedIndex < suggestions.length
            ? previous.selectedIndex
            : 0,
      }));
    },
    [isReadOnly, mentionableAgents, textareaRef]
  );

  const restoreComposerSelection = useCallback(
    (selection: TextSelectionRange) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(selection.start, selection.end);
      selectionRangeRef.current = selection;
      updateAgentMentionAutocomplete(textarea.value, selection);
    },
    [textareaRef, updateAgentMentionAutocomplete]
  );

  const insertComposerText = useCallback(
    (text: string, range?: { from: number; to: number }) => {
      setInputValue((previous) => {
        const fallbackSelection = selectionRangeRef.current;
        const rawStart = range?.from ?? fallbackSelection.start;
        const rawEnd = range?.to ?? fallbackSelection.end;
        const start = Math.max(0, Math.min(rawStart, previous.length));
        const end = Math.max(start, Math.min(rawEnd, previous.length));
        const nextValue = `${previous.slice(0, start)}${text}${previous.slice(end)}`;
        const nextSelection = {
          start: start + text.length,
          end: start + text.length,
        };

        pendingSelectionRangeRef.current = nextSelection;
        selectionRangeRef.current = nextSelection;
        return nextValue;
      });
    },
    [setInputValue]
  );

  const onAgentMentionSelect = useCallback(
    (agent: AgentCatalogItem, range: { from: number; to: number }) => {
      insertComposerText(`@${agent.id} `, range);
      setAgentMentionAutocomplete(null);
    },
    [insertComposerText]
  );

  useEffect(() => {
    const pendingSelection = pendingSelectionRangeRef.current;
    if (!pendingSelection) return;

    const frameId = requestAnimationFrame(() => {
      restoreComposerSelection(pendingSelection);
      pendingSelectionRangeRef.current = null;
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [inputValue, restoreComposerSelection]);

  const clearAgentMentionAutocomplete = useCallback(() => {
    setAgentMentionAutocomplete(null);
  }, []);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      syncTextareaSelection(event.currentTarget);
      setInputValue(event.target.value);
      updateAgentMentionAutocomplete(event.target.value, selectionRangeRef.current);
    },
    [setInputValue, syncTextareaSelection, updateAgentMentionAutocomplete]
  );

  const handleTextareaSelectionChange = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      syncTextareaSelection(event.currentTarget);
      updateAgentMentionAutocomplete(event.currentTarget.value, selectionRangeRef.current);
    },
    [syncTextareaSelection, updateAgentMentionAutocomplete]
  );

  const handleTextareaKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === "Escape" ||
        event.key === "Tab"
      ) {
        return;
      }

      handleTextareaSelectionChange(event);
    },
    [handleTextareaSelectionChange]
  );

  const handleMentionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!agentMentionAutocomplete || agentMentionAutocomplete.suggestions.length === 0) {
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAgentMentionAutocomplete((previous) => {
          if (!previous) return null;

          return {
            ...previous,
            selectedIndex: (previous.selectedIndex + 1) % previous.suggestions.length,
          };
        });
        return true;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAgentMentionAutocomplete((previous) => {
          if (!previous) return null;

          return {
            ...previous,
            selectedIndex:
              (previous.selectedIndex - 1 + previous.suggestions.length) %
              previous.suggestions.length,
          };
        });
        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected =
          agentMentionAutocomplete.suggestions[agentMentionAutocomplete.selectedIndex];
        if (selected) {
          onAgentMentionSelect(selected, {
            from: agentMentionAutocomplete.from,
            to: agentMentionAutocomplete.to,
          });
        }
        return true;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setAgentMentionAutocomplete(null);
        return true;
      }

      return false;
    },
    [agentMentionAutocomplete, onAgentMentionSelect]
  );

  const handleTextareaBlur = useCallback(() => {
    clearAgentMentionAutocomplete();
  }, [clearAgentMentionAutocomplete]);

  return {
    agentMentionAutocomplete,
    clearAgentMentionAutocomplete,
    handleInputChange,
    handleMentionKeyDown,
    handleTextareaBlur,
    handleTextareaKeyUp,
    handleTextareaSelectionChange,
    insertComposerText,
    onAgentMentionSelect,
  };
}
