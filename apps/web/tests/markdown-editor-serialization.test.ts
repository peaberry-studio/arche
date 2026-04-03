// @vitest-environment jsdom

import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  encodeMarkdownForEditor,
  normalizeMarkdownForKb,
} from "@/components/workspace/markdown-editor-content";

function createMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        markedOptions: {
          gfm: true,
        },
      }),
    ],
    content,
    contentType: "markdown",
    immediatelyRender: false,
  });
}

describe("markdown editor serialization", () => {
  it("preserves gfm tables and checklists", () => {
    const source = [
      "| Metrica | Valor |",
      "| --- | --- |",
      "| CPA | 6.56 |",
      "",
      "- [ ] Auditar funnel",
      "- [x] Pausar IT003-A8",
      "",
    ].join("\n");

    const editor = createMarkdownEditor(source);
    const markdown = editor.getMarkdown();

    expect(markdown).toContain("| Metrica | Valor |");
    expect(markdown).toMatch(/\|\s*-{3,}\s*\|\s*-{3,}\s*\|/);
    expect(markdown).toContain("- [ ] Auditar funnel");
    expect(markdown).toContain("- [x] Pausar IT003-A8");

    editor.destroy();
  });

  it("round-trips consecutive blank lines through the rich editor", () => {
    const source = ["Line 1", "", "", "", "Line 2", "", "", "Line 3"].join("\n");

    const editor = createMarkdownEditor(encodeMarkdownForEditor(source));
    const markdown = normalizeMarkdownForKb(editor.getMarkdown());

    expect(markdown).toBe(source);

    editor.destroy();
  });
});
