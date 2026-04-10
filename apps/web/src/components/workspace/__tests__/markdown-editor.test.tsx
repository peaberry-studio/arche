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
    expect(screen.getByText("title")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("preserves the original YAML block when only the markdown body changes", async () => {
    const onChange = vi.fn();
    fakeMarkdown = "## Updated";

    render(
      <MarkdownEditor
        value={["---", 'title: "Alpha"', "---", "# Body"].join("\n")}
        onChange={onChange}
        saveState="saved"
      />
    );

    await Promise.resolve();

    capturedEditorOptions?.onUpdate?.({ editor: fakeEditor });

    expect(onChange).toHaveBeenCalledWith(["---", 'title: "Alpha"', "---", "## Updated"].join("\n"));
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

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText("Property 1 value"), {
      target: { value: "Beta" },
    });

    expect(onChange).toHaveBeenCalledWith(["---", "title: Beta", "---", "# Body"].join("\n"));
  });

  it("does not coerce cleared numeric properties to zero while typing", () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value={["---", "rating: 4", "---", "# Body"].join("\n")}
        onChange={onChange}
        saveState="saved"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const input = screen.getByLabelText("Property 1 value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "42" } });

    expect(onChange).toHaveBeenCalledWith(["---", "rating: 42", "---", "# Body"].join("\n"));
  });

  it("does not persist a blank property when adding a new row", () => {
    const onChange = vi.fn();

    render(
      <MarkdownEditor
        value="# Body"
        onChange={onChange}
        saveState="saved"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByLabelText("Property 1 key")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
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
