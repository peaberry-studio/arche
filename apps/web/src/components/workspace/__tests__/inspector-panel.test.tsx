/** @vitest-environment jsdom */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InspectorPanel } from "@/components/workspace/inspector-panel";

const markdownEditorMock = vi.fn(
  ({ onOpenInternalLink }: { onOpenInternalLink?: (path: string) => void }) => (
    <MockMarkdownEditor onOpenInternalLink={onOpenInternalLink} />
  )
);

function MockMarkdownEditor({
  onOpenInternalLink,
}: {
  onOpenInternalLink?: (path: string) => void
}) {
  const [label, setLabel] = useState('initial')

  return (
    <div>
      <button type="button" onClick={() => onOpenInternalLink?.("docs/target.md")}>
        Open link
      </button>
      <button type="button" onClick={() => setLabel('dirty')}>
        Mutate editor
      </button>
      <span>Editor state: {label}</span>
      Markdown editor
    </div>
  )
}

vi.mock("@/components/workspace/markdown-editor", () => ({
  MarkdownEditor: (props: unknown) => markdownEditorMock(props as { onOpenInternalLink?: (path: string) => void }),
}));

vi.mock("@/components/workspace/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe("InspectorPanel", () => {
  beforeEach(() => {
    markdownEditorMock.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const defaultProps = {
    openFiles: [
      {
        path: "docs/notes.md",
        title: "notes.md",
        content: "# Notes",
        updatedAt: "now",
        size: "1.0 KB",
        kind: "text" as const,
      },
    ],
    activeFilePath: "docs/notes.md" as string | null,
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    diffs: [],
    onOpenFile: vi.fn(),
    rightCollapsed: false,
    onToggleRight: vi.fn(),
  };

  it("does not render a download action in the preview toolbar", () => {
    render(<InspectorPanel {...defaultProps} />);

    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("renders a back control when onBack is provided", () => {
    const onBack = vi.fn();
    render(<InspectorPanel {...defaultProps} hideCollapseButton onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders markdown preview instead of the editor when workspace agent support is disabled", () => {
    render(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: "notes.md",
            title: "notes.md",
            content: "# Hello",
            updatedAt: "now",
            size: "1 KB",
            kind: "markdown" as const,
          },
        ]}
        activeFilePath="notes.md"
        workspaceAgentEnabled={false}
      />
    );

    expect(screen.queryByText("Markdown editor")).toBeNull();
    expect(screen.getByText("# Hello")).toBeTruthy();
  });

  it("passes internal markdown paths and link opener to markdown editor", () => {
    const onOpenFile = vi.fn();

    render(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: "notes.md",
            title: "notes.md",
            content: "[[docs/target.md]]",
            updatedAt: "now",
            size: "1 KB",
            kind: "markdown" as const,
          },
        ]}
        activeFilePath="notes.md"
        internalLinkPaths={["docs/target.md", "docs/other.md"]}
        onOpenFile={onOpenFile}
        onSaveFile={vi.fn().mockResolvedValue({ ok: true })}
      />
    );

    expect(markdownEditorMock).toHaveBeenCalled();
    const latestCallProps = markdownEditorMock.mock.calls.at(-1)?.[0] as {
      internalLinkPaths?: string[];
    };
    expect(latestCallProps.internalLinkPaths).toEqual(["docs/target.md", "docs/other.md"]);

    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(onOpenFile).toHaveBeenCalledWith("docs/target.md");
  });

  it('remounts the markdown editor when switching active files', () => {
    const onSaveFile = vi.fn().mockResolvedValue({ ok: true })

    const { rerender } = render(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: 'first.md',
            title: 'first.md',
            content: '# First',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'markdown' as const,
          },
          {
            path: 'second.md',
            title: 'second.md',
            content: '# Second',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'markdown' as const,
          },
        ]}
        activeFilePath='first.md'
        onSaveFile={onSaveFile}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mutate editor' }))
    expect(screen.getByText('Editor state: dirty')).toBeTruthy()

    rerender(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: 'first.md',
            title: 'first.md',
            content: '# First',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'markdown' as const,
          },
          {
            path: 'second.md',
            title: 'second.md',
            content: '# Second',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'markdown' as const,
          },
        ]}
        activeFilePath='second.md'
        onSaveFile={onSaveFile}
      />
    )

    expect(screen.getByText('Editor state: initial')).toBeTruthy()
  })

  it('uses a raw text editor for conflicted markdown files', () => {
    render(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: 'conflict.md',
            title: 'conflict.md',
            content: '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> kb/main\n',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'markdown' as const,
          },
        ]}
        activeFilePath="conflict.md"
        diffs={[
          { path: 'conflict.md', status: 'modified', additions: 1, deletions: 1, diff: 'diff', conflicted: true },
        ]}
        onSaveFile={vi.fn().mockResolvedValue({ ok: true })}
      />
    )

    expect(screen.getByRole('textbox', { name: 'Edit conflict file' })).toBeTruthy()
    expect(screen.getByText(/Edit the conflict markers directly/)).toBeTruthy()
    expect(markdownEditorMock).not.toHaveBeenCalled()
  })

  it('expands minified panels through the files shortcut', () => {
    const onToggleRight = vi.fn()
    render(
      <InspectorPanel
        {...defaultProps}
        rightCollapsed
        onToggleRight={onToggleRight}
      />
    )

    expect(screen.queryByRole('button', { name: /review/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand panel' }))
    expect(onToggleRight).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onToggleRight).toHaveBeenCalledTimes(2)
  })

  it('handles the expanded inspector, file tabs, and close buttons', () => {
    const onCloseFile = vi.fn()
    const onSelectFile = vi.fn()
    const onToggleRight = vi.fn()

    render(
      <InspectorPanel
        {...defaultProps}
        openFiles={[
          {
            path: 'first.md',
            title: 'first.md',
            content: '# First',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'text' as const,
          },
          {
            path: 'second.md',
            title: 'second.md',
            content: '# Second',
            updatedAt: 'later',
            size: '2 KB',
            kind: 'text' as const,
          },
        ]}
        activeFilePath="first.md"
        diffs={[
          { path: 'first.md', status: 'modified', additions: 2, deletions: 1, diff: 'diff', conflicted: false },
          { path: 'second.md', status: 'added', additions: 4, deletions: 0, diff: 'diff', conflicted: false },
        ]}
        onCloseFile={onCloseFile}
        onSelectFile={onSelectFile}
        onToggleRight={onToggleRight}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }))
    expect(onToggleRight).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'second.md' }))
    expect(onSelectFile).toHaveBeenCalledWith('second.md')

    fireEvent.click(screen.getByRole('button', { name: 'Close first.md' }))
    expect(onCloseFile).toHaveBeenCalledWith('first.md')
  })

  it('renders without the collapse header when the button is hidden', () => {
    render(
      <InspectorPanel
        {...defaultProps}
        hideCollapseButton
        openFiles={[
          {
            path: 'notes.txt',
            title: 'notes.txt',
            content: 'Plain text note',
            updatedAt: 'now',
            size: '1 KB',
            kind: 'text' as const,
          },
        ]}
        activeFilePath="notes.txt"
      />
    )

    expect(screen.queryByRole('button', { name: 'Collapse panel' })).toBeNull()
    expect(screen.getAllByText('notes.txt').length).toBe(2)
    expect(screen.getByText('Plain text note')).toBeTruthy()
  })
});
