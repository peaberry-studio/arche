/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@/components/workspace/markdown-editor";

const chain = {
  addColumnAfter: vi.fn(() => chain),
  addRowAfter: vi.fn(() => chain),
  deleteColumn: vi.fn(() => chain),
  deleteRow: vi.fn(() => chain),
  focus: vi.fn(() => chain),
  insertContentAt: vi.fn(() => chain),
  insertTable: vi.fn(() => chain),
  redo: vi.fn(() => chain),
  run: vi.fn(() => true),
  setParagraph: vi.fn(() => chain),
  setTextSelection: vi.fn(() => chain),
  toggleBlockquote: vi.fn(() => chain),
  toggleBold: vi.fn(() => chain),
  toggleBulletList: vi.fn(() => chain),
  toggleCodeBlock: vi.fn(() => chain),
  toggleHeading: vi.fn(() => chain),
  toggleItalic: vi.fn(() => chain),
  toggleOrderedList: vi.fn(() => chain),
  toggleTaskList: vi.fn(() => chain),
  undo: vi.fn(() => chain),
};

const fakeEditor = {
  can: () => ({ chain: () => chain }),
  chain: () => chain,
  commands: {
    focus: vi.fn(),
    setContent: vi.fn(),
    setTextSelection: vi.fn(),
  },
  getMarkdown: () => fakeMarkdown,
  isActive: () => false,
  state: {
    doc: {
      content: {
        size: 1,
      },
    },
    selection: {
      $from: {
        parent: {
          textContent: "",
        },
        parentOffset: 0,
        start: () => 1,
      },
      empty: true,
      from: 1,
      to: 1,
    },
  },
};

let fakeMarkdown = "";

let capturedEditorOptions: {
  content?: string;
  editorProps?: {
    handleClick?: (view: { dom: HTMLElement }, pos: number, event: MouseEvent) => boolean;
  };
  onUpdate?: (args: { editor: typeof fakeEditor }) => void;
} | null = null;

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div>Editor Content</div>,
  useEditor: (options: typeof capturedEditorOptions) => {
    capturedEditorOptions = options;
    return fakeEditor;
  },
}));

describe("MarkdownEditor", () => {
  afterEach(() => {
    cleanup();
    capturedEditorOptions = null;
    fakeMarkdown = "";
  });

  it("does not intercept standard markdown links as internal KB links", () => {
    const onOpenInternalLink = vi.fn();

    render(
      <MarkdownEditor
        value="[Alpha](docs/alpha.md)"
        onChange={vi.fn()}
        saveState="saved"
        internalLinkPaths={["docs/alpha.md"]}
        onOpenInternalLink={onOpenInternalLink}
      />
    );

    const link = document.createElement("a");
    link.setAttribute("href", "docs/alpha.md");

    const didHandleClick = capturedEditorOptions?.editorProps?.handleClick?.(
      { dom: document.createElement("div") },
      0,
      { target: link } as unknown as MouseEvent
    );

    expect(didHandleClick).toBe(false);
    expect(onOpenInternalLink).not.toHaveBeenCalled();
  });

  it("passes only the markdown body into tiptap when YAML frontmatter exists", () => {
    render(
      <MarkdownEditor
        value={["---", "title: Alpha", "---", "# Body"].join("\n")}
        onChange={vi.fn()}
        saveState="saved"
      />
    );

    expect(capturedEditorOptions?.content).toBe("# Body");
    expect(screen.getByDisplayValue("title")).toBeTruthy();
    expect(screen.getByDisplayValue("Alpha")).toBeTruthy();
  });

  it("reassembles YAML frontmatter before emitting editor changes", async () => {
    const onChange = vi.fn();
    fakeMarkdown = "## Updated";

    render(
      <MarkdownEditor
        value={["---", "title: Alpha", "---", "# Body"].join("\n")}
        onChange={onChange}
        saveState="saved"
      />
    );

    await Promise.resolve();

    capturedEditorOptions?.onUpdate?.({ editor: fakeEditor });

    expect(onChange).toHaveBeenCalledWith(["---", "title: Alpha", "---", "## Updated"].join("\n"));
  });

  it("updates structured properties above the editor", () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value={["---", "title: Alpha", "---", "# Body"].join("\n")}
        onChange={onChange}
        saveState="saved"
      />
    );

    fireEvent.change(screen.getByLabelText("Property 1 value"), {
      target: { value: "Beta" },
    });

    expect(onChange).toHaveBeenCalledWith(["---", "title: Beta", "---", "# Body"].join("\n"));
  });

  it("uses raw YAML mode for unsupported frontmatter", () => {
    render(
      <MarkdownEditor
        value={["---", "seo:", "  title: Alpha", "---", "# Body"].join("\n")}
        onChange={vi.fn()}
        saveState="saved"
      />
    );

    expect(screen.getByLabelText("YAML frontmatter")).toBeTruthy();
    expect(screen.getByText(/raw mode/i)).toBeTruthy();
  });
});
