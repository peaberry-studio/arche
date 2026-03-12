/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InspectorPanel } from "@/components/workspace/inspector-panel";

vi.mock("@/components/workspace/markdown-editor", () => ({
  MarkdownEditor: () => <div>Markdown editor</div>,
}));

vi.mock("@/components/workspace/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/workspace/review-panel", () => ({
  ReviewPanel: () => <div>Review panel</div>,
}));

describe("InspectorPanel", () => {
  beforeEach(() => {
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

  it("downloads the active file from the preview toolbar", () => {
    const onDownloadFile = vi.fn();

    render(
      <InspectorPanel
        {...defaultProps}
        onDownloadFile={onDownloadFile}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /download notes.md/i }));

    expect(onDownloadFile).toHaveBeenCalledWith("docs/notes.md");
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
});
