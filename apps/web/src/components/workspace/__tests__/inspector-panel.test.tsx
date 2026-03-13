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

  it("downloads the active file from the preview toolbar", () => {
    const onDownloadFile = vi.fn();

    render(
      <InspectorPanel
        slug="alice"
        activeTab="preview"
        onTabChange={() => {}}
        rightCollapsed={false}
        onToggleRight={() => {}}
        openFiles={[
          {
            path: "docs/notes.md",
            title: "notes.md",
            content: "# Notes",
            updatedAt: "now",
            size: "1.0 KB",
            kind: "text",
          },
        ]}
        activeFilePath="docs/notes.md"
        onSelectFile={() => {}}
        onCloseFile={() => {}}
        diffs={[]}
        onOpenFile={() => {}}
        onDownloadFile={onDownloadFile}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /download notes.md/i }));

    expect(onDownloadFile).toHaveBeenCalledWith("docs/notes.md");
  });
});
