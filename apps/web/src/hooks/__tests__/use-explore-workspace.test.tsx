/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceRuntimeProvider } from "@/contexts/workspace-runtime-context";
import { useExploreWorkspace } from "@/hooks/use-explore-workspace";

const connectionMock = {
  connection: { status: "connected" as const },
  isConnected: true,
};

const downloadWorkspaceFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/workspace-file-download", () => ({
  downloadWorkspaceFile: downloadWorkspaceFileMock,
}));

vi.mock("@/hooks/use-workspace-connection", () => ({
  useWorkspaceConnection: () => connectionMock,
}));

vi.mock("@/hooks/use-instance-heartbeat", () => ({
  useInstanceHeartbeat: () => undefined,
}));

vi.mock("@/hooks/use-instance-startup", () => ({
  useInstanceStartup: () => ({ instanceStatus: "running", instanceError: null }),
}));

function renderExploreHook(
  callback: () => ReturnType<typeof useExploreWorkspace>,
) {
  return renderHook(callback, {
    wrapper: ({ children }) => (
      <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
        {children}
      </WorkspaceRuntimeProvider>
    ),
  })
}

const opencodeMocks = vi.hoisted(() => ({
  loadFileTreeAction: vi.fn(),
  readFileAction: vi.fn(),
  getWorkspaceDiffsAction: vi.fn(),
}));

const workspaceAgentMocks = vi.hoisted(() => ({
  readWorkspaceFileAction: vi.fn(),
  writeWorkspaceFileAction: vi.fn(),
  deleteWorkspaceFileAction: vi.fn(),
  applyWorkspacePatchAction: vi.fn(),
  discardWorkspaceFileChangesAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);
vi.mock("@/actions/workspace-agent", () => workspaceAgentMocks);

describe("useExploreWorkspace", () => {
  beforeEach(() => {
    stubBrowserStorage();
    connectionMock.connection = { status: "connected" };
    connectionMock.isConnected = true;
    opencodeMocks.loadFileTreeAction.mockResolvedValue({
      ok: true,
      tree: [
        {
          id: "docs",
          name: "docs",
          path: "docs",
          type: "directory",
          children: [
            { id: "docs/plan.md", name: "plan.md", path: "docs/plan.md", type: "file" },
            { id: "docs/linked.md", name: "linked.md", path: "docs/linked.md", type: "file" },
          ],
        },
      ],
    });
    opencodeMocks.readFileAction.mockResolvedValue({
      ok: true,
      content: { content: "# Plan", type: "raw" },
    });
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({ ok: true, diffs: [] });
    workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({
      ok: true,
      content: { content: "# Plan", type: "raw" },
      hash: "hash-plan",
    });
    workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValue({ ok: true, hash: "hash-updated" });
    workspaceAgentMocks.deleteWorkspaceFileAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.applyWorkspacePatchAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.discardWorkspaceFileChangesAction.mockResolvedValue({ ok: true });
    downloadWorkspaceFileMock.mockReset();
  });

  it("loads the file tree once connected", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice" })
    );

    await waitFor(() => {
      expect(result.current.fileTree).toHaveLength(1);
    });

    expect(result.current.fileTree[0]).toMatchObject({
      path: "docs",
      type: "directory",
    });
    expect(opencodeMocks.loadFileTreeAction).toHaveBeenCalledWith("alice");
  });

  it("loads pending manual edits (diffs) once connected", async () => {
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({
      ok: true,
      diffs: [
        {
          path: "docs/plan.md",
          status: "modified",
          additions: 2,
          deletions: 1,
          diff: "@@ -1 +1 @@",
          conflicted: false,
        },
      ],
    });

    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice" })
    );

    await waitFor(
      () => {
        expect(result.current.diffs).toHaveLength(1);
      },
      // The diffs refresh runs after the file tree load; under full-suite load
      // the default 1s timeout is not enough.
      { timeout: 5000 }
    );
    expect(result.current.diffs[0]).toMatchObject({
      path: "docs/plan.md",
      conflicted: false,
    });
    expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalledWith("alice");
  });

  it("opens a file into the multi-file tabs and loads its content", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice" })
    );

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    await act(async () => {
      await result.current.onOpenFile("docs/plan.md");
    });

    expect(result.current.activeFilePath).toBe("docs/plan.md");
    expect(result.current.openFilePaths).toEqual(["docs/plan.md"]);
    expect(result.current.openFiles).toHaveLength(1);
    expect(result.current.openFiles[0]).toMatchObject({
      path: "docs/plan.md",
      content: "# Plan",
      kind: "markdown",
    });
  });

  it("seeds the active file from the initial file path", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({
        slug: "alice",
        storageScope: "alice",
        initialFilePath: "docs/linked.md",
      })
    );

    await waitFor(() => {
      expect(result.current.openFilePaths).toEqual(["docs/linked.md"]);
    });
    expect(result.current.activeFilePath).toBe("docs/linked.md");
  });

  it("saves file edits through the workspace agent and refreshes diffs", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    await act(async () => {
      const saveResult = await result.current.onSaveFile("docs/plan.md", "# Updated");
      expect(saveResult.ok).toBe(true);
    });

    expect(workspaceAgentMocks.writeWorkspaceFileAction).toHaveBeenCalledWith(
      "alice",
      "docs/plan.md",
      "# Updated",
      "hash-plan"
    );
    await waitFor(() => {
      expect(result.current.openFiles[0].content).toBe("# Updated");
    });
  });

  it("discards changes and removes a deleted file from the tabs", async () => {
    workspaceAgentMocks.discardWorkspaceFileChangesAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({ ok: false, error: "not_found" });
    opencodeMocks.readFileAction.mockResolvedValue({ ok: false, error: "not_found" });

    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    await act(async () => {
      const discardResult = await result.current.onDiscardFileChanges("docs/plan.md");
      expect(discardResult.ok).toBe(true);
    });

    expect(result.current.openFilePaths).toEqual([]);
  });

  it("persists and restores open files across remounts", async () => {
    const first = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );
    await waitFor(() => {
      expect(first.result.current.openFilePaths).toEqual(["docs/plan.md"]);
    });

    await act(async () => {
      await first.result.current.onOpenFile("docs/linked.md");
    });
    first.unmount();

    const second = renderExploreHook(() => useExploreWorkspace({ slug: "alice", storageScope: "alice" }));
    await waitFor(() => {
      expect(second.result.current.openFilePaths).toEqual(["docs/plan.md", "docs/linked.md"]);
    });
    second.unmount();
  });

  it("ignores protected initial file paths", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({
        slug: "alice",
        storageScope: "alice",
        initialFilePath: "node_modules/pkg/index.js",
      })
    );

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.openFilePaths).toEqual([]);
    expect(result.current.activeFilePath).toBeNull();
    expect(result.current.openFiles).toEqual([]);
  });

  it("refuses to open protected paths from the file tree", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice" })
    );

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    await act(async () => {
      await result.current.onOpenFile("node_modules/pkg/index.js");
      await result.current.onOpenFile(".git/config");
    });

    expect(result.current.openFilePaths).toEqual([]);
    expect(result.current.activeFilePath).toBeNull();
    expect(workspaceAgentMocks.readWorkspaceFileAction).not.toHaveBeenCalledWith(
      "node_modules/pkg/index.js"
    );
  });

  it("returns save errors and keeps the cached content on write conflicts", async () => {
    workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValueOnce({
      ok: false,
      error: "write_conflict",
    });

    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    await act(async () => {
      const saveResult = await result.current.onSaveFile("docs/plan.md", "# Conflicting edit");
      expect(saveResult).toEqual({ ok: false, error: "write_conflict" });
    });

    expect(result.current.openFiles[0].content).toBe("# Plan");
    expect(result.current.openFiles[0].hash).toBe("hash-plan");
  });

  it("falls back to the last remaining tab when the active file is closed", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    await act(async () => {
      await result.current.onOpenFile("docs/linked.md");
    });
    expect(result.current.activeFilePath).toBe("docs/linked.md");

    act(() => {
      result.current.onSelectFile("docs/plan.md");
    });
    expect(result.current.activeFilePath).toBe("docs/plan.md");

    act(() => {
      result.current.onCloseFile("docs/plan.md");
    });

    expect(result.current.openFilePaths).toEqual(["docs/linked.md"]);
    expect(result.current.activeFilePath).toBe("docs/linked.md");
  });

  it("downloads files with the workspace slug", async () => {
    const { result } = renderExploreHook(() =>
      useExploreWorkspace({ slug: "alice", storageScope: "alice", initialFilePath: "docs/plan.md" })
    );

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    result.current.onDownloadFile("docs/plan.md");

    expect(downloadWorkspaceFileMock).toHaveBeenCalledWith("alice", "docs/plan.md");
  });
});
