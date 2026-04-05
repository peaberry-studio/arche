/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
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
  getMarkdown: () => "",
  isActive: () => false,
  state: {
    doc: {
      content: {
        size: 1,
      },
    },
    selection: {
      empty: true,
      from: 1,
      to: 1,
    },
  },
};

let capturedEditorOptions: {
  editorProps?: {
    handleClick?: (view: { dom: HTMLElement }, pos: number, event: MouseEvent) => boolean;
  };
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
});
