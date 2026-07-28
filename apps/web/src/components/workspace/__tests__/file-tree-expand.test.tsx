/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileTree } from "@/components/workspace/file-tree";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

const deepNodes: WorkspaceFileNode[] = [
  {
    id: "Company",
    name: "Company",
    path: "Company",
    type: "directory",
    children: [
      {
        id: "Company/Research",
        name: "Research",
        path: "Company/Research",
        type: "directory",
        children: [
          {
            id: "Company/Research/Issues",
            name: "Issues",
            path: "Company/Research/Issues",
            type: "directory",
            children: [
              {
                id: "Company/Research/Issues/deep-file.md",
                name: "deep-file.md",
                path: "Company/Research/Issues/deep-file.md",
                type: "file",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "Engineering",
    name: "Engineering",
    path: "Engineering",
    type: "directory",
    children: [
      {
        id: "Engineering/readme.md",
        name: "readme.md",
        path: "Engineering/readme.md",
        type: "file",
      },
    ],
  },
];

describe("FileTree auto-expand", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("expands ancestor directories when activePath points to a deeply nested file", () => {
    render(
      <FileTree
        nodes={deepNodes}
        activePath="Company/Research/Issues/deep-file.md"
        onSelect={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /deep-file\.md/i })).toBeDefined();
  });

  it("does not auto-expand unrelated subdirectories when activePath is set elsewhere", () => {
    render(
      <FileTree
        nodes={deepNodes}
        activePath="Engineering/readme.md"
        onSelect={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /readme\.md/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /deep-file\.md/i })).toBeNull();
  });

  it("keeps subdirectories collapsed when activePath is null", () => {
    const nodes: WorkspaceFileNode[] = [
      {
        id: "A",
        name: "A",
        path: "A",
        type: "directory",
        children: [
          {
            id: "A/B",
            name: "B",
            path: "A/B",
            type: "directory",
            children: [
              {
                id: "A/B/file.md",
                name: "file.md",
                path: "A/B/file.md",
                type: "file",
              },
            ],
          },
        ],
      },
    ];

    render(
      <FileTree
        nodes={nodes}
        activePath={null}
        onSelect={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /^B$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /file\.md/i })).toBeNull();
  });
});
