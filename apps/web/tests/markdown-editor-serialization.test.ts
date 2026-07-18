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
import { describe, expect, it, vi } from "vitest";

import {
  encodeMarkdownForEditor,
  normalizeMarkdownForKb,
} from "@/components/workspace/markdown-editor-content";
import { VegaLiteChart } from "@/components/workspace/vega-lite-chart-node";

vi.mock("vega-embed", () => ({
  default: vi.fn().mockResolvedValue({ finalize: vi.fn() }),
}));

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
      VegaLiteChart,
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

function countNodeTypes(editor: Editor): Record<string, number> {
  const counts: Record<string, number> = {};
  editor.state.doc.descendants((node) => {
    counts[node.type.name] = (counts[node.type.name] ?? 0) + 1;
    return true;
  });
  return counts;
}

const VEGA_LITE_SPEC = [
  "{",
  '  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",',
  '  "data": { "values": [{ "quarter": "Q1", "revenue": 10 }] },',
  '  "mark": "bar",',
  '  "encoding": {',
  '    "x": { "field": "quarter", "type": "nominal" },',
  '    "y": { "field": "revenue", "type": "quantitative" }',
  "  }",
  "}",
].join("\n");

const VEGA_LITE_FENCE = ["```vega-lite", VEGA_LITE_SPEC, "```"].join("\n");

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

  it("parses vega-lite fences into atom nodes instead of code blocks", () => {
    const editor = createMarkdownEditor(VEGA_LITE_FENCE);
    const counts = countNodeTypes(editor);

    expect(counts["vegaLiteChart"]).toBe(1);
    expect(counts["codeBlock"]).toBeUndefined();

    editor.destroy();
  });

  it("round-trips a vega-lite fence losslessly via getMarkdown", () => {
    const editor = createMarkdownEditor(VEGA_LITE_FENCE);
    const markdown = editor.getMarkdown();

    expect(markdown).toContain("```vega-lite");
    expect(markdown).toContain(VEGA_LITE_SPEC);

    editor.destroy();
  });

  it("allows deleting the atom node and removes the fence from output", () => {
    const editor = createMarkdownEditor(VEGA_LITE_FENCE);

    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (node.type.name === "vegaLiteChart") {
        pos = nodePos;
        return false;
      }
      return true;
    });
    expect(pos).toBeGreaterThanOrEqual(0);

    editor
      .chain()
      .setTextSelection({ from: pos, to: pos + 1 })
      .deleteSelection()
      .run();

    const markdown = editor.getMarkdown();
    expect(markdown).not.toContain("```vega-lite");
    expect(markdown).not.toContain(VEGA_LITE_SPEC);

    editor.destroy();
  });

  it("parses multiple vega-lite fences as separate atom nodes and round-trips both", () => {
    const source = [
      "Before chart.",
      "",
      VEGA_LITE_FENCE,
      "",
      "Between charts.",
      "",
      VEGA_LITE_FENCE,
      "",
      "After chart.",
    ].join("\n");

    const editor = createMarkdownEditor(source);
    const counts = countNodeTypes(editor);

    expect(counts["vegaLiteChart"]).toBe(2);

    const markdown = editor.getMarkdown();
    const fenceCount = (markdown.match(/```vega-lite/gu) ?? []).length;
    expect(fenceCount).toBe(2);
    expect(markdown).toContain("Before chart.");
    expect(markdown).toContain("Between charts.");
    expect(markdown).toContain("After chart.");

    editor.destroy();
  });

  it("leaves non-vega-lite code fences as codeBlock nodes", () => {
    const source = ["```js", "const x = 1;", "```"].join("\n");

    const editor = createMarkdownEditor(source);
    const counts = countNodeTypes(editor);

    expect(counts["codeBlock"]).toBe(1);
    expect(counts["vegaLiteChart"]).toBeUndefined();

    const markdown = editor.getMarkdown();
    expect(markdown).toContain("```js");
    expect(markdown).toContain("const x = 1;");

    editor.destroy();
  });

  it("still parses invalid vega-lite fence bodies as atom nodes for round-trip", () => {
    const invalidBody = "{ this is not valid json }";
    const source = ["```vega-lite", invalidBody, "```"].join("\n");

    const editor = createMarkdownEditor(source);
    const counts = countNodeTypes(editor);

    expect(counts["vegaLiteChart"]).toBe(1);
    expect(counts["codeBlock"]).toBeUndefined();

    const markdown = editor.getMarkdown();
    expect(markdown).toContain("```vega-lite");
    expect(markdown).toContain(invalidBody);

    editor.destroy();
  });

  it("does not break paragraphs that merely mention ```vega-lite as text", () => {
    const source = "Some text mentioning ```vega-lite in a paragraph.";
    const editor = createMarkdownEditor(source);
    const counts = countNodeTypes(editor);

    expect(counts["vegaLiteChart"]).toBeUndefined();
    expect(counts["paragraph"]).toBeGreaterThanOrEqual(1);

    editor.destroy();
  });
});
