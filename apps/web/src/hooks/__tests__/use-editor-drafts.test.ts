// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorDrafts, type SaveResult } from "@/hooks/use-editor-drafts";

async function advanceAutosave(ms = 600) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useEditorDrafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getDraft without draft returns fallback", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    expect(result.current.getDraft("kb/note.md", "fallback")).toBe("fallback");
  });

  it("getDraft with draft returns the draft", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    act(() => {
      result.current.handleChange("kb/note.md", "draft", "fallback");
    });

    expect(result.current.getDraft("kb/note.md", "fallback")).toBe("draft");
  });

  it("handleChange stores draft and sets state=dirty", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    act(() => {
      result.current.handleChange("kb/note.md", "new content", "original");
    });

    expect(result.current.getDraft("kb/note.md", "original")).toBe("new content");
    expect(result.current.getSaveState("kb/note.md")).toBe("dirty");
  });

  it("autosave runs after debounce and ends in saved", async () => {
    const onSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "autosaved", "original");
    });

    expect(result.current.getSaveState("kb/note.md")).toBe("dirty");

    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("kb/note.md", "autosaved", undefined);
    expect(result.current.getSaveState("kb/note.md")).toBe("saved");
    expect(result.current.getSaveError("kb/note.md")).toBeNull();
  });

  it("failed save sets state=error with message", async () => {
    const onSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: false, error: "save_failed" }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "autosaved", "original");
    });

    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.getSaveState("kb/note.md")).toBe("error");
    expect(result.current.getSaveError("kb/note.md")).toBe("save_failed");
  });

  it("clearDraft cancels timer, clears draft, and resets to idle", async () => {
    const onSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "pending save", "original");
      result.current.clearDraft("kb/note.md");
    });

    await advanceAutosave();

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.getDraft("kb/note.md", "original")).toBe("original");
    expect(result.current.getSaveState("kb/note.md")).toBe("idle");
    expect(result.current.getSaveError("kb/note.md")).toBeNull();
  });

  it("quick edits only save the latest", async () => {
    const onSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "first", "original");
      result.current.handleChange("kb/note.md", "second", "original");
    });

    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("kb/note.md", "second", undefined);
    expect(result.current.getSaveState("kb/note.md")).toBe("saved");
  });

  it("onSave uses the most recent reference when changed between schedule and fire", async () => {
    const firstOnSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));
    const secondOnSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));

    const { result, rerender } = renderHook(
      ({ onSave }: { onSave: (path: string, content: string) => Promise<SaveResult> }) =>
        useEditorDrafts({ onSave }),
      { initialProps: { onSave: firstOnSave } }
    );

    act(() => {
      result.current.handleChange("kb/note.md", "value", "original");
    });

    rerender({ onSave: secondOnSave });

    await advanceAutosave();

    expect(firstOnSave).not.toHaveBeenCalled();
    expect(secondOnSave).toHaveBeenCalledTimes(1);
    expect(secondOnSave).toHaveBeenCalledWith("kb/note.md", "value", undefined);
  });

  it("keeps base expectedHash even if sourceHash changes during draft", async () => {
    const onSave = vi.fn<
      (path: string, content: string, expectedHash?: string) => Promise<SaveResult>
    >(async () => ({ ok: true, hash: "hash-saved" }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "first", "original", "hash-a");
      result.current.handleChange("kb/note.md", "second", "remote-content", "hash-b");
    });

    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("kb/note.md", "second", "hash-a");
  });

  it("does not save when content === baseline", async () => {
    const onSave = vi.fn<
      (path: string, content: string) => Promise<SaveResult>
    >(async () => ({ ok: true }));
    const { result } = renderHook(() => useEditorDrafts({ onSave }));

    act(() => {
      result.current.handleChange("kb/note.md", "saved version", "original");
    });

    await advanceAutosave();

    expect(onSave).toHaveBeenCalledTimes(1);

    onSave.mockClear();

    act(() => {
      result.current.handleChange("kb/note.md", "saved version", "original");
    });

    expect(result.current.getSaveState("kb/note.md")).toBe("idle");

    await advanceAutosave();

    expect(onSave).not.toHaveBeenCalled();
  });
});
