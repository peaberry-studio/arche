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

vi.mock("@/components/workspace/review-panel", () => ({
  ReviewPanel: () => <div>Review panel</div>,
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
    slug: "alice",
    activeTab: "preview" as const,
    onTabChange: vi.fn(),
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

  it("hides review features when workspace agent support is disabled", () => {
    render(
      <InspectorPanel
        {...defaultProps}
        workspaceAgentEnabled={false}
      />
    );

    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.queryByText("Review panel")).toBeNull();
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
});
