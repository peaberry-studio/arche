/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceFiles } from "@/hooks/use-workspace-files";

const opencodeMocks = vi.hoisted(() => ({
  loadFileTreeAction: vi.fn(),
  readFileAction: vi.fn(),
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

describe("useWorkspaceFiles", () => {
  beforeEach(() => {
    opencodeMocks.loadFileTreeAction.mockResolvedValue({
      ok: true,
      tree: [{ name: "README.md", type: "file" }],
    });
    opencodeMocks.readFileAction.mockResolvedValue({
      ok: true,
      content: { content: "# Hello", type: "raw" },
    });
    workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({
      ok: false,
      error: "not_found",
    });
    workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValue({
      ok: true,
      hash: "abc123",
    });
    workspaceAgentMocks.deleteWorkspaceFileAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.applyWorkspacePatchAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.discardWorkspaceFileChangesAction.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts with empty file tree and not loading", () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));
    expect(result.current.fileTree).toEqual([]);
    expect(result.current.isLoadingFiles).toBe(false);
  });

  it("loads file tree on refreshFiles", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    await act(async () => {
      await result.current.refreshFiles();
    });

    expect(result.current.fileTree).toEqual([{ name: "README.md", type: "file" }]);
    expect(opencodeMocks.loadFileTreeAction).toHaveBeenCalledWith("alice");
  });

  it("sets isLoadingFiles during refresh", async () => {
    let resolve: (() => void) | null = null;
    opencodeMocks.loadFileTreeAction.mockReturnValue(
      new Promise((r) => {
        resolve = () => r({ ok: true, tree: [] });
      })
    );

    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshFiles();
    });

    await waitFor(() => {
      expect(result.current.isLoadingFiles).toBe(true);
    });

    await act(async () => {
      resolve!();
      await refreshPromise!;
    });

    expect(result.current.isLoadingFiles).toBe(false);
  });

  it("reads file via workspace agent first, falls back to opencode", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const file = await act(async () => result.current.readFile("README.md"));

    expect(workspaceAgentMocks.readWorkspaceFileAction).toHaveBeenCalledWith("alice", "README.md");
    expect(opencodeMocks.readFileAction).toHaveBeenCalledWith("alice", "README.md");
    expect(file).toEqual({ content: "# Hello", type: "raw" });
  });

  it("returns workspace agent result when available", async () => {
    workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({
      ok: true,
      content: { content: "patched content", type: "patch" },
      hash: "hash1",
    });

    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const file = await act(async () => result.current.readFile("file.txt"));

    expect(file).toEqual({ content: "patched content", type: "patch", hash: "hash1" });
    expect(opencodeMocks.readFileAction).not.toHaveBeenCalled();
  });

  it("returns null when both sources fail", async () => {
    opencodeMocks.readFileAction.mockResolvedValue({ ok: false, error: "not_found" });

    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const file = await act(async () => result.current.readFile("missing.txt"));
    expect(file).toBeNull();
  });

  it("writes file and returns hash on success", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const writeResult = await act(async () =>
      result.current.writeFile("file.txt", "content", "expectedHash")
    );

    expect(writeResult).toEqual({ ok: true, hash: "abc123" });
    expect(workspaceAgentMocks.writeWorkspaceFileAction).toHaveBeenCalledWith(
      "alice",
      "file.txt",
      "content",
      "expectedHash"
    );
  });

  it("returns error on write failure", async () => {
    workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValue({
      ok: false,
      error: "conflict",
    });

    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const writeResult = await act(async () =>
      result.current.writeFile("file.txt", "content")
    );

    expect(writeResult).toEqual({ ok: false, error: "conflict" });
  });

  it("deletes file and returns boolean", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const deleted = await act(async () => result.current.deleteFile("file.txt"));
    expect(deleted).toBe(true);

    workspaceAgentMocks.deleteWorkspaceFileAction.mockResolvedValue({ ok: false });
    const notDeleted = await act(async () => result.current.deleteFile("file.txt"));
    expect(notDeleted).toBe(false);
  });

  it("applies patch and returns boolean", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const applied = await act(async () => result.current.applyPatch("diff content"));
    expect(applied).toBe(true);
    expect(workspaceAgentMocks.applyWorkspacePatchAction).toHaveBeenCalledWith("alice", "diff content");
  });

  it("discards file changes and handles errors", async () => {
    const { result } = renderHook(() => useWorkspaceFiles("alice"));

    const discardResult = await act(async () => result.current.discardFileChanges("file.txt"));
    expect(discardResult).toEqual({ ok: true });

    workspaceAgentMocks.discardWorkspaceFileChangesAction.mockRejectedValue(
      new Error("disk error")
    );
    const errorResult = await act(async () => result.current.discardFileChanges("file.txt"));
    expect(errorResult).toEqual({ ok: false, error: "disk error" });
  });
});
