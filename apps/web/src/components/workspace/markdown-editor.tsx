"use client";

import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  PencilSimple,
  Table as TableIcon,
} from "@phosphor-icons/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, type Editor as TiptapEditor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { Button } from "@/components/ui/button";
import { InternalLinkAutocomplete } from "@/components/workspace/internal-link-autocomplete";
import {
  parseMarkdownFrontmatter,
  replaceMarkdownFrontmatterBody,
  serializeMarkdownFrontmatter,
  type MarkdownFrontmatterProperty,
} from "@/components/workspace/markdown-frontmatter";
import { MarkdownFrontmatterPanel } from "@/components/workspace/markdown-frontmatter-panel";
import { MarkdownTableControls } from "@/components/workspace/markdown-table-controls";
import { getInternalLinkHoverPosition } from "@/components/workspace/internal-link-hover-position";
import { ObsidianLinkDecorations } from "@/components/workspace/obsidian-link-decorations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  encodeMarkdownForEditor,
  isEquivalentMarkdown,
  normalizeMarkdownForKb,
} from "@/components/workspace/markdown-editor-content";
import type { SaveState } from "@/hooks/use-editor-drafts";
import {
  buildInternalLinkSuggestions,
  findObsidianAutocompleteMatch,
  resolveObsidianLinkTarget,
} from "@/lib/kb-internal-links";
import { cn } from "@/lib/utils";

const HOVERED_LINK_HIDE_DELAY_MS = 300;
type MarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  saveState: SaveState;
  saveError?: string | null;
  onReload?: () => void;
  modifiedAt?: string;
  internalLinkPaths?: string[];
  onOpenInternalLink?: (path: string) => void;
};

type LinkAutocompleteState = {
  from: number;
  to: number;
  left: number;
  top: number;
  selectedIndex: number;
  suggestions: ReturnType<typeof buildInternalLinkSuggestions>;
};

type HoveredLinkState = {
  from: number;
  path: string;
  to: number;
  target: string;
  left: number;
  top: number;
};

function getInternalLinkElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest(".kb-internal-link") : null;
}

function readHoveredLinkStateFromElement(
  element: HTMLElement,
  scroller: HTMLElement
): HoveredLinkState | null {
  const from = Number.parseInt(element.dataset.linkFrom ?? "", 10);
  const to = Number.parseInt(element.dataset.linkTo ?? "", 10);
  const target = element.dataset.linkTarget;
  const path = element.dataset.linkPath;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !target || !path) {
    return null;
  }

  const linkRect = element.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const position = getInternalLinkHoverPosition({
    anchorBottom: linkRect.bottom,
    anchorLeft: linkRect.left,
    anchorTop: linkRect.top,
    scrollerClientHeight: scroller.clientHeight,
    scrollerClientWidth: scroller.clientWidth,
    scrollerLeft: scrollerRect.left,
    scrollerScrollLeft: scroller.scrollLeft,
    scrollerScrollTop: scroller.scrollTop,
    scrollerTop: scrollerRect.top,
  });

  return {
    from,
    path,
    to,
    target,
    left: position.left,
    top: position.top,
  };
}

export function MarkdownEditor({
  value,
  onChange,
  saveState,
  saveError,
  onReload,
  modifiedAt,
  internalLinkPaths = [],
  onOpenInternalLink,
}: MarkdownEditorProps) {
  const ignoreNextUpdateRef = useRef(false);
  const lastEmittedMarkdownRef = useRef<string | null>(null);
  const hoveredLinkHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const [linkAutocomplete, setLinkAutocomplete] = useState<LinkAutocompleteState | null>(null);
  const [hoveredLink, setHoveredLink] = useState<HoveredLinkState | null>(null);
  const frontmatter = useMemo(() => parseMarkdownFrontmatter(value), [value]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const handlePropertiesChange = useCallback(
    (properties: MarkdownFrontmatterProperty[]) => {
      onChange(
        serializeMarkdownFrontmatter(
          {
            mode: properties.length > 0 ? "structured" : "none",
            properties,
            raw: "",
          },
          frontmatter.body
        )
      );
    },
    [frontmatter.body, onChange]
  );

  const handleRawFrontmatterChange = useCallback(
    (raw: string) => {
      onChange(
        serializeMarkdownFrontmatter(
          {
            mode: "raw",
            properties: [],
            raw,
          },
          frontmatter.body
        )
      );
    },
    [frontmatter.body, onChange]
  );

  const clearHoveredLinkHideTimeout = useCallback(() => {
    if (!hoveredLinkHideTimeoutRef.current) return;
    clearTimeout(hoveredLinkHideTimeoutRef.current);
    hoveredLinkHideTimeoutRef.current = null;
  }, []);

  const hideHoveredLink = useCallback(() => {
    clearHoveredLinkHideTimeout();
    setHoveredLink(null);
  }, [clearHoveredLinkHideTimeout]);

  const scheduleHoveredLinkHide = useCallback(() => {
    clearHoveredLinkHideTimeout();
    hoveredLinkHideTimeoutRef.current = setTimeout(() => {
      hoveredLinkHideTimeoutRef.current = null;
      setHoveredLink(null);
    }, HOVERED_LINK_HIDE_DELAY_MS);
  }, [clearHoveredLinkHideTimeout]);

  const showHoveredLink = useCallback(
    (nextLink: HoveredLinkState) => {
      clearHoveredLinkHideTimeout();
      setHoveredLink((previous) => {
        if (
          previous &&
          previous.from === nextLink.from &&
          previous.to === nextLink.to &&
          previous.target === nextLink.target &&
          previous.path === nextLink.path &&
          previous.left === nextLink.left &&
          previous.top === nextLink.top
        ) {
          return previous;
        }

        return nextLink;
      });
    },
    [clearHoveredLinkHideTimeout]
  );

  const handleWorkspaceMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const hoverCard =
        event.target instanceof HTMLElement
          ? event.target.closest("[data-kb-internal-link-hover-card]")
          : null;
      if (hoverCard) {
        clearHoveredLinkHideTimeout();
        return;
      }

      const linkElement = getInternalLinkElement(event.target);
      if (!linkElement) {
        scheduleHoveredLinkHide();
        return;
      }

      const nextHoveredLink = readHoveredLinkStateFromElement(linkElement, event.currentTarget);
      if (!nextHoveredLink) {
        scheduleHoveredLinkHide();
        return;
      }

      showHoveredLink(nextHoveredLink);
    },
    [clearHoveredLinkHideTimeout, scheduleHoveredLinkHide, showHoveredLink]
  );

  const updateLinkAutocomplete = useCallback(
    (editor: TiptapEditor) => {
      const selection = editor.state.selection;
      if (!selection.empty) {
        setLinkAutocomplete(null);
        return;
      }

      const parentText = selection.$from.parent.textContent.slice(0, selection.$from.parentOffset);
      const match = findObsidianAutocompleteMatch(parentText);
      if (!match) {
        setLinkAutocomplete(null);
        return;
      }

      const suggestions = buildInternalLinkSuggestions(internalLinkPaths, match.query);
      if (suggestions.length === 0) {
        setLinkAutocomplete(null);
        return;
      }

      const from = selection.$from.start() + match.from;
      const to = selection.$from.start() + match.to;
      const coords = editor.view.coordsAtPos(selection.from);
      const scroller = editor.view.dom.closest(".workspace-tiptap") as HTMLElement | null;

      if (!scroller) {
        setLinkAutocomplete(null);
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();

      setLinkAutocomplete((previous) => ({
        from,
        to,
        suggestions,
        left: coords.left - scrollerRect.left + scroller.scrollLeft,
        top: coords.bottom - scrollerRect.top + scroller.scrollTop + 8,
        selectedIndex:
          previous &&
          previous.from === from &&
          previous.to === to &&
          previous.selectedIndex < suggestions.length
            ? previous.selectedIndex
            : 0,
      }));
    },
    [internalLinkPaths]
  );

  const openResolvedInternalLink = useCallback(
    (rawTarget: string) => {
      if (!onOpenInternalLink) return false;
      const resolved = resolveObsidianLinkTarget(rawTarget, internalLinkPaths);
      if (!resolved) return false;
      onOpenInternalLink(resolved);
      return true;
    },
    [internalLinkPaths, onOpenInternalLink]
  );

  useEffect(() => {
    return () => {
      clearHoveredLinkHideTimeout();
    };
  }, [clearHoveredLinkHideTimeout]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
        },
      }),
      Placeholder.configure({ placeholder: "Write…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ObsidianLinkDecorations,
      Markdown.configure({
        markedOptions: {
          gfm: true,
        },
      }),
    ],
    content: encodeMarkdownForEditor(frontmatter.body),
    contentType: "markdown",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (ignoreNextUpdateRef.current) return;

      const nextBody = normalizeMarkdownForKb(editor.getMarkdown());
      lastEmittedMarkdownRef.current = nextBody;
      onChange(replaceMarkdownFrontmatterBody(valueRef.current, nextBody));
      updateLinkAutocomplete(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      updateLinkAutocomplete(editor);
    },
    onBlur: () => {
      setLinkAutocomplete(null);
      hideHoveredLink();
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor",
      },
      handleClick: (view, _pos, event) => {
        const linkElement = getInternalLinkElement(event.target);
        if (!linkElement) return false;

        const scroller = view.dom.closest(".workspace-tiptap") as HTMLElement | null;
        if (!scroller) return false;

        const hoveredLinkState = readHoveredLinkStateFromElement(linkElement, scroller);
        if (!hoveredLinkState) return false;

        if (openResolvedInternalLink(hoveredLinkState.target)) {
          hideHoveredLink();
          return true;
        }

        editor?.chain().focus().setTextSelection({ from: hoveredLinkState.from, to: hoveredLinkState.to }).run();
        return true;
      },
      handleDOMEvents: {
        mousedown: () => {
          hideHoveredLink();
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        if (!linkAutocomplete || linkAutocomplete.suggestions.length === 0) return false;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setLinkAutocomplete((previous) => {
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
          setLinkAutocomplete((previous) => {
            if (!previous) return null;
            return {
              ...previous,
              selectedIndex:
                (previous.selectedIndex - 1 + previous.suggestions.length) % previous.suggestions.length,
            };
          });
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          const selected = linkAutocomplete.suggestions[linkAutocomplete.selectedIndex];
          if (selected) {
            view.dispatch(
              view.state.tr.insertText(
                `[[${selected.path}]]`,
                linkAutocomplete.from,
                linkAutocomplete.to
              )
            );
            view.focus();
            setLinkAutocomplete(null);
          }
          return true;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setLinkAutocomplete(null);
          return true;
        }

        return false;
      },
    },
  });

  const applyInternalLinkSuggestion = useCallback(
    (path: string) => {
      if (!editor || !linkAutocomplete) return;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: linkAutocomplete.from, to: linkAutocomplete.to }, `[[${path}]]`)
        .run();
      setLinkAutocomplete(null);
    },
    [editor, linkAutocomplete]
  );

  const focusLinkForEditing = useCallback(() => {
    if (!editor || !hoveredLink) return;
    editor.chain().focus().setTextSelection({ from: hoveredLink.from, to: hoveredLink.to }).run();
    hideHoveredLink();
  }, [editor, hideHoveredLink, hoveredLink]);

  useEffect(() => {
    if (!editor) return;

    const current = normalizeMarkdownForKb(editor.getMarkdown());
    if (isEquivalentMarkdown(current, frontmatter.body)) return;

    if (
      lastEmittedMarkdownRef.current !== null &&
      isEquivalentMarkdown(lastEmittedMarkdownRef.current, frontmatter.body)
    ) {
      return;
    }

    const previousSelection = editor.state.selection;
    const previousFrom = previousSelection.from;
    const previousTo = previousSelection.to;
    const wasAtEnd = previousSelection.empty && previousTo >= editor.state.doc.content.size;

    ignoreNextUpdateRef.current = true;
    lastEmittedMarkdownRef.current = frontmatter.body;
    editor.commands.setContent(encodeMarkdownForEditor(frontmatter.body), { contentType: "markdown" });

    if (wasAtEnd) {
      editor.commands.focus("end");
    } else {
      const maxPosition = Math.max(1, editor.state.doc.content.size);
      editor.commands.setTextSelection({
        from: Math.min(previousFrom, maxPosition),
        to: Math.min(previousTo, maxPosition),
      });
    }

    queueMicrotask(() => {
      ignoreNextUpdateRef.current = false;
    });
  }, [editor, frontmatter.body]);

  const reloadRecommended = Boolean(saveState === "error" && saveError && saveError.includes("conflict"));
  const isEditing = saveState === "dirty" || saveState === "saving";
  const isError = saveState === "error";
  const statusLabel = isError ? "Error" : isEditing ? "Editing" : "Saved";

  const headingLabel =
    editor?.isActive("heading", { level: 1 })
      ? "H1"
      : editor?.isActive("heading", { level: 2 })
        ? "H2"
        : editor?.isActive("heading", { level: 3 })
          ? "H3"
          : "H";
  const editorScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full flex-col">
      <MarkdownFrontmatterPanel
        editable
        frontmatter={frontmatter}
        onPropertiesChange={handlePropertiesChange}
        onRawChange={handleRawFrontmatterChange}
      />

      <div className="mx-4 pt-2 pb-4">
        <div className="h-px bg-border/40" />
      </div>

      <div className="mx-4 mb-1 flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-foreground/[0.02] px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none"  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                aria-label="Headings"
              >
                {headingLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="min-w-[140px]">
              <DropdownMenuItem onSelect={() => editor?.chain().focus().setParagraph().run()}>
                Paragraph
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
                Heading 1
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
                Heading 2
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
                Heading 3
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!editor?.can().chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <span className={cn("font-semibold", editor?.isActive("bold") && "text-foreground")}>
              B
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!editor?.can().chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <span className={cn("italic", editor?.isActive("italic") && "text-foreground")}>
              I
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            aria-label="Bullet list"
          >
            <span className={cn(editor?.isActive("bulletList") && "text-foreground")}>•</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            aria-label="Ordered list"
          >
            <span className={cn(editor?.isActive("orderedList") && "text-foreground")}>1.</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            aria-label="Checklist"
          >
            <span className={cn(editor?.isActive("taskList") && "text-foreground")}>☑</span>
          </Button>
          <div className="mx-1 h-4 w-px bg-border/40" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            aria-label="Quote"
          >
            <span className={cn(editor?.isActive("blockquote") && "text-foreground")}>
              &quot;
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            aria-label="Code block"
          >
            <span className={cn(editor?.isActive("codeBlock") && "text-foreground")}>
              {"</>"}
            </span>
          </Button>
          <div className="mx-1 h-4 w-px bg-border/40" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            aria-label="Insert table"
            title="Insert table"
          >
            <TableIcon size={14} weight="bold" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border/40" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor?.can().chain().focus().undo().run()}
            aria-label="Undo"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor?.can().chain().focus().redo().run()}
            aria-label="Redo"
          >
            <ArrowClockwise size={14} weight="bold" />
          </Button>
          {onReload && reloadRecommended ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={onReload}
            >
              Reload
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          {modifiedAt ? <span className="shrink-0 text-muted-foreground">{modifiedAt}</span> : null}
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isError ? "bg-destructive" : isEditing ? "bg-amber-400" : "bg-emerald-500",
                isEditing && "animate-pulse"
              )}
            />
            <span>{statusLabel}</span>
          </div>
          {saveState === "error" && saveError ? (
            <span className="min-w-0 truncate text-destructive/90" title={saveError}>
              {saveError}
            </span>
          ) : null}
        </div>
      </div>

      <div
        ref={editorScrollRef}
        className="workspace-tiptap relative flex-1 overflow-y-auto px-6 pt-2 pb-5 scrollbar-none"
        onMouseLeave={scheduleHoveredLinkHide}
        onMouseMove={handleWorkspaceMouseMove}
      >
        <EditorContent editor={editor} />
        <MarkdownTableControls containerRef={editorScrollRef} editor={editor} />
        {hoveredLink ? (
          <div
            className="absolute z-20 flex max-w-72 flex-col gap-2 rounded-md border border-border/50 bg-background/95 p-2 shadow-lg backdrop-blur-sm"
            data-kb-internal-link-hover-card="true"
            style={{ left: hoveredLink.left, top: hoveredLink.top }}
            onMouseEnter={clearHoveredLinkHideTimeout}
            onMouseLeave={scheduleHoveredLinkHide}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <div className="truncate text-[10px] text-muted-foreground" title={hoveredLink.path}>
              {hoveredLink.path}
            </div>
            <button
              type="button"
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border/50 px-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={focusLinkForEditing}
            >
              <PencilSimple size={11} weight="bold" />
              Edit link
            </button>
          </div>
        ) : null}
        <InternalLinkAutocomplete
          open={Boolean(linkAutocomplete)}
          left={linkAutocomplete?.left ?? 0}
          top={linkAutocomplete?.top ?? 0}
          suggestions={linkAutocomplete?.suggestions ?? []}
          selectedIndex={linkAutocomplete?.selectedIndex ?? 0}
          onSelect={applyInternalLinkSuggestion}
        />
      </div>
    </div>
  );
}
