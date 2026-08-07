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
    const onExportFileDocx = vi.fn();

    render(
      <FileTreePanel
        nodes={nodes}
        activePath={null}
        onSelect={() => {}}
        onDownloadFile={onDownloadFile}
        onExportFileDocx={onExportFileDocx}
      />
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /alpha.md/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /download file/i }));

    expect(onDownloadFile).toHaveBeenCalledWith("alpha.md");

    fireEvent.contextMenu(screen.getByRole("button", { name: /alpha.md/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /export as docx/i }));
    expect(onExportFileDocx).toHaveBeenCalledWith("alpha.md");
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
