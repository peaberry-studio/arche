"use client";

import { useEffect, useRef } from "react";

import { ArrowClockwise, ArrowCounterClockwise } from "@phosphor-icons/react";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SaveState } from "@/hooks/use-editor-drafts";
import { cn } from "@/lib/utils";

function normalizeMarkdownForKb(value: string): string {
  return value.replaceAll("\u00A0", " ").replaceAll("&nbsp;", " ");
}

type MarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  saveState: SaveState;
  saveError?: string | null;
  onReload?: () => void;
  modifiedAt?: string;
};

export function MarkdownEditor({
  value,
  onChange,
  saveState,
  saveError,
  onReload,
  modifiedAt,
}: MarkdownEditorProps) {
  const ignoreNextUpdateRef = useRef(false);
  const lastEmittedMarkdownRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write…" }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
        },
      }),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (ignoreNextUpdateRef.current) return;

      const next = normalizeMarkdownForKb(editor.getMarkdown());
      lastEmittedMarkdownRef.current = next;
      onChange(next);
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;

    const current = normalizeMarkdownForKb(editor.getMarkdown());
    if (current === value) return;

    // If the parent is just echoing what we emitted, don't reset editor state.
    if (lastEmittedMarkdownRef.current === value) return;

    ignoreNextUpdateRef.current = true;
    lastEmittedMarkdownRef.current = value;
    editor.commands.setContent(value, { contentType: "markdown" });
    queueMicrotask(() => {
      ignoreNextUpdateRef.current = false;
    });
  }, [editor, value]);

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-1.5">
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
          <div className="mx-1 h-4 w-px bg-white/10" />
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
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          {modifiedAt ? <span className="shrink-0 text-muted-foreground">{modifiedAt}</span> : null}
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">
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

      <div className="workspace-tiptap flex-1 overflow-y-auto px-6 py-5 scrollbar-none">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
