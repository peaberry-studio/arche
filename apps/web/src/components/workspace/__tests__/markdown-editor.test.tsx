/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  view: {
    coordsAtPos: vi.fn(() => ({ bottom: 48, left: 24 })),
    dom: document.createElement("div"),
  },
};

let fakeMarkdown = "";

let capturedEditorOptions: {
  content?: string;
  editorProps?: {
    handleClick?: (view: { dom: HTMLElement }, pos: number, event: MouseEvent) => boolean;
    handleDOMEvents?: {
      mousedown?: () => boolean;
    };
    handleKeyDown?: (
      view: {
        dispatch: (transaction: unknown) => void;
        focus: () => void;
        state: { tr: { insertText: (text: string, from: number, to: number) => unknown } };
      },
      event: KeyboardEvent
    ) => boolean;
  };
  onBlur?: () => void;
  onSelectionUpdate?: (args: { editor: typeof fakeEditor }) => void;
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
  beforeEach(() => {
    vi.clearAllMocks();
    fakeEditor.state.selection.$from.parent.textContent = "";
    fakeEditor.state.selection.$from.parentOffset = 0;
    fakeEditor.state.selection.$from.start = () => 1;
    fakeEditor.state.selection.empty = true;
    fakeEditor.state.selection.from = 1;
    fakeEditor.state.selection.to = 1;
    fakeEditor.view.dom = document.createElement("div");
  });

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

  it("keeps the toolbar fixed above properties and editor content", () => {
    render(
      <MarkdownEditor
        value={["---", "title: Alpha", "---", "# Body"].join("\n")}
        onChange={vi.fn()}
        saveState="saved"
      />
    );

    const scroller = document.querySelector(".workspace-tiptap") as HTMLElement;
    const toolbar = screen.getByTestId("markdown-editor-toolbar");
    const toolbarButton = screen.getByRole("button", { name: "Headings" });
    const propertiesButton = screen.getByRole("button", { name: /Properties/ });

    expect(toolbar.className).toContain("border-b");
    expect(toolbar.className).not.toContain("rounded");
    expect(toolbar.className).not.toContain("bg-foreground");
    expect(scroller.contains(toolbarButton)).toBe(false);
    expect(scroller.contains(propertiesButton)).toBe(true);
    expect(scroller.textContent).toContain("Editor Content");
    expect(toolbarButton.compareDocumentPosition(propertiesButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("runs toolbar actions and shows conflict reload affordances", () => {
    const onReload = vi.fn();

    render(
      <MarkdownEditor
        value="# Body"
        onChange={vi.fn()}
        saveState="error"
        saveError="merge conflict detected"
        modifiedAt="Updated now"
        onReload={onReload}
      />
    );

    expect(screen.getByText("Updated now")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("merge conflict detected")).toBeTruthy();

    vi.clearAllMocks();
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    fireEvent.click(screen.getByRole("button", { name: "Ordered list" }));
    fireEvent.click(screen.getByRole("button", { name: "Checklist" }));
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Code block" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(chain.toggleBold).toHaveBeenCalled();
    expect(chain.toggleItalic).toHaveBeenCalled();
    expect(chain.toggleBulletList).toHaveBeenCalled();
    expect(chain.toggleOrderedList).toHaveBeenCalled();
    expect(chain.toggleTaskList).toHaveBeenCalled();
    expect(chain.toggleBlockquote).toHaveBeenCalled();
    expect(chain.toggleCodeBlock).toHaveBeenCalled();
    expect(chain.insertTable).toHaveBeenCalledWith({ rows: 3, cols: 3, withHeaderRow: true });
    expect(chain.undo).toHaveBeenCalled();
    expect(chain.redo).toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("opens resolved internal links and selects unresolved links for editing", () => {
    const onOpenInternalLink = vi.fn();
    render(
      <MarkdownEditor
        value="[[Notes/Alpha.md]]"
        onChange={vi.fn()}
        saveState="saved"
        internalLinkPaths={["Notes/Alpha.md"]}
        onOpenInternalLink={onOpenInternalLink}
      />
    );

    const { dom, link } = createInternalLinkFixture("Notes/Alpha.md");
    const handled = capturedEditorOptions?.editorProps?.handleClick?.(
      { dom },
      0,
      { target: link } as unknown as MouseEvent
    );

    expect(handled).toBe(true);
    expect(onOpenInternalLink).toHaveBeenCalledWith("Notes/Alpha.md");

    vi.clearAllMocks();
    const unresolved = createInternalLinkFixture("Missing.md");
    const handledUnresolved = capturedEditorOptions?.editorProps?.handleClick?.(
      { dom: unresolved.dom },
      0,
      { target: unresolved.link } as unknown as MouseEvent
    );

    expect(handledUnresolved).toBe(true);
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 18 });
  });

  it("shows hovered internal links and hides them on blur", () => {
    render(
      <MarkdownEditor
        value="[[Notes/Alpha.md]]"
        onChange={vi.fn()}
        saveState="saved"
        internalLinkPaths={["Notes/Alpha.md"]}
      />
    );

    const scroller = document.querySelector(".workspace-tiptap") as HTMLElement;
    configureScroller(scroller);
    const link = createInternalLinkElement("Notes/Alpha.md");
    scroller.appendChild(link);

    fireEvent.mouseMove(link);

    expect(screen.getByText("Notes/Alpha.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    expect(chain.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 18 });

    act(() => {
      capturedEditorOptions?.onBlur?.();
    });
    expect(screen.queryByRole("button", { name: "Edit link" })).toBeNull();
  });

  it("applies internal link autocomplete suggestions by keyboard and mouse", async () => {
    render(
      <MarkdownEditor
        value="[[Al"
        onChange={vi.fn()}
        saveState="saved"
        internalLinkPaths={["Docs/Alpha.md", "Docs/Alpine.md"]}
      />
    );

    fakeEditor.view.dom = screen.getByText("Editor Content") as HTMLElement;
    fakeEditor.state.selection.$from.parent.textContent = "[[Al";
    fakeEditor.state.selection.$from.parentOffset = 4;
    fakeEditor.state.selection.from = 4;

    await act(async () => {
      capturedEditorOptions?.onSelectionUpdate?.({ editor: fakeEditor });
    });

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Docs/Alpha.md")).toBeTruthy();

    const dispatch = vi.fn();
    const focus = vi.fn();
    const insertText = vi.fn(() => ({ type: "transaction" }));
    const keyView = { dispatch, focus, state: { tr: { insertText } } };
    const arrowDown = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as KeyboardEvent;
    const enter = { key: "Enter", preventDefault: vi.fn() } as unknown as KeyboardEvent;
    const escape = { key: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent;

    expect(capturedEditorOptions?.editorProps?.handleKeyDown?.(keyView, arrowDown)).toBe(true);
    expect(capturedEditorOptions?.editorProps?.handleKeyDown?.(keyView, enter)).toBe(true);
    expect(insertText).toHaveBeenCalledWith("[[Docs/Alpha.md]]", 1, 5);
    expect(dispatch).toHaveBeenCalledWith({ type: "transaction" });
    expect(focus).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedEditorOptions?.onSelectionUpdate?.({ editor: fakeEditor });
    });
    fireEvent.mouseDown(screen.getByText("Alpha"));
    expect(chain.insertContentAt).toHaveBeenCalledWith({ from: 1, to: 5 }, "[[Docs/Alpha.md]]");

    await act(async () => {
      capturedEditorOptions?.onSelectionUpdate?.({ editor: fakeEditor });
    });
    expect(capturedEditorOptions?.editorProps?.handleKeyDown?.(keyView, escape)).toBe(true);
  });
});

function configureScroller(scroller: HTMLElement) {
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    clientWidth: { configurable: true, value: 640 },
    scrollLeft: { configurable: true, value: 0 },
    scrollTop: { configurable: true, value: 0 },
  });
  scroller.getBoundingClientRect = () => ({
    bottom: 400,
    height: 400,
    left: 0,
    right: 640,
    top: 0,
    width: 640,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function createInternalLinkElement(target: string) {
  const link = document.createElement("span");
  link.className = "kb-internal-link";
  link.dataset.linkFrom = "2";
  link.dataset.linkTo = "18";
  link.dataset.linkTarget = target;
  link.dataset.linkPath = target;
  link.getBoundingClientRect = () => ({
    bottom: 44,
    height: 20,
    left: 32,
    right: 132,
    top: 24,
    width: 100,
    x: 32,
    y: 24,
    toJSON: () => ({}),
  });
  return link;
}

function createInternalLinkFixture(target: string) {
  const scroller = document.createElement("div");
  scroller.className = "workspace-tiptap";
  configureScroller(scroller);
  const dom = document.createElement("div");
  scroller.appendChild(dom);
  const link = createInternalLinkElement(target);
  dom.appendChild(link);
  return { dom, link };
}
