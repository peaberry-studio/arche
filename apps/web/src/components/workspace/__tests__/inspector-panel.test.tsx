/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { InspectorPanel } from "@/components/workspace/inspector-panel";

vi.mock("@/components/workspace/markdown-editor", () => ({
  MarkdownEditor: () => <div>markdown-editor</div>,
}));

vi.mock("@/components/workspace/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/components/workspace/review-panel", () => ({
  ReviewPanel: () => <div>review-panel</div>,
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
});

describe("InspectorPanel", () => {
  const defaultProps = {
    slug: "alice",
    activeTab: "preview" as const,
    onTabChange: vi.fn(),
    openFiles: [
      {
        path: "notes.md",
        title: "notes.md",
        content: "# Hello",
        updatedAt: "now",
        size: "1 KB",
        kind: "markdown" as const,
      },
    ],
    activeFilePath: "notes.md" as string | null,
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    diffs: [],
    onOpenFile: vi.fn(),
    rightCollapsed: false,
    onToggleRight: vi.fn(),
  };

  it("hides review features when workspace agent support is disabled", () => {
    render(
      <InspectorPanel
        {...defaultProps}
        workspaceAgentEnabled={false}
      />
    );

    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.queryByText("review-panel")).toBeNull();
  });

  it("renders markdown preview instead of the editor when workspace agent support is disabled", () => {
    render(
      <InspectorPanel
        {...defaultProps}
        workspaceAgentEnabled={false}
      />
    );

    expect(screen.queryByText("markdown-editor")).toBeNull();
    expect(screen.getByText("# Hello")).toBeTruthy();
  });
});
