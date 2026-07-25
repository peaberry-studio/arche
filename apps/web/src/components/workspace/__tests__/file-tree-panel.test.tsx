/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileTreePanel } from "@/components/workspace/file-tree-panel";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

const nodes: WorkspaceFileNode[] = [
  {
    id: "docs",
    name: "docs",
    path: "docs",
    type: "directory",
    children: [
      {
        id: "notes",
        name: "notes.md",
        path: "docs/notes.md",
        type: "file",
      },
    ],
  },
  {
    id: "alpha",
    name: "alpha.md",
    path: "alpha.md",
    type: "file",
  },
];

describe("FileTreePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a context menu for tree files and downloads the selected file", async () => {
    const onDownloadFile = vi.fn();

    render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={() => {}}
        onDownloadFile={onDownloadFile}
      />
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /alpha.md/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /download file/i }));

    expect(onDownloadFile).toHaveBeenCalledWith("alpha.md");
  });

  it("auto-expands top-level directories when nodes arrive", async () => {
    render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={() => {}}
      />
    );

    expect(await screen.findByRole("button", { name: /notes.md/i })).toBeTruthy();
  });

  it("expands ancestor directories of the active file path", async () => {
    const deepNodes: WorkspaceFileNode[] = [
      {
        id: "docs",
        name: "docs",
        path: "docs",
        type: "directory",
        children: [
          {
            id: "docs/research",
            name: "research",
            path: "docs/research",
            type: "directory",
            children: [
              {
                id: "docs/research/analysis.md",
                name: "analysis.md",
                path: "docs/research/analysis.md",
                type: "file",
              },
            ],
          },
        ],
      },
    ];

    render(
      <FileTreePanel
        nodes={deepNodes}
        activePath="docs/research/analysis.md"
        onSelect={() => {}}
      />
    );

    expect(await screen.findByRole("button", { name: /analysis.md/i })).toBeTruthy();
  });

  it("preserves user-collapsed directories on subsequent updates", async () => {
    const onSelect = vi.fn();

    const { rerender } = render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={onSelect}
      />
    );

    const docsButton = await screen.findByRole("button", { name: /^docs$/i });
    expect(screen.getByRole("button", { name: /notes.md/i })).toBeTruthy();

    fireEvent.click(docsButton);

    expect(screen.queryByRole("button", { name: /notes.md/i })).toBeNull();

    rerender(
      <FileTreePanel
        nodes={nodes}
        activePath="alpha.md"
        onSelect={onSelect}
      />
    );

    expect(screen.queryByRole("button", { name: /notes.md/i })).toBeNull();
  });

  it("expands a collapsed dir when navigating to a file inside it", async () => {
    const onSelect = vi.fn();

    const { rerender } = render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={onSelect}
      />
    );

    const docsButton = await screen.findByRole("button", { name: /^docs$/i });
    expect(screen.getByRole("button", { name: /notes.md/i })).toBeTruthy();

    fireEvent.click(docsButton);
    expect(screen.queryByRole("button", { name: /notes.md/i })).toBeNull();

    rerender(
      <FileTreePanel
        nodes={nodes}
        activePath="docs/notes.md"
        onSelect={onSelect}
      />
    );

    expect(await screen.findByRole("button", { name: /notes.md/i })).toBeTruthy();
  });

  it("supports downloading files from search results too", async () => {
    const onDownloadFile = vi.fn();

    render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={() => {}}
        onDownloadFile={onDownloadFile}
        query="notes"
      />
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /notes.md/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /download file/i }));

    expect(onDownloadFile).toHaveBeenCalledWith("docs/notes.md");
  });
});
