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

  it("getDraft sin draft devuelve fallback", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    expect(result.current.getDraft("kb/note.md", "fallback")).toBe("fallback");
  });

  it("getDraft con draft devuelve el draft", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    act(() => {
      result.current.handleChange("kb/note.md", "draft", "fallback");
    });

    expect(result.current.getDraft("kb/note.md", "fallback")).toBe("draft");
  });

  it("handleChange almacena draft y pone state=dirty", () => {
    const { result } = renderHook(() => useEditorDrafts({ onSave: undefined }));

    act(() => {
      result.current.handleChange("kb/note.md", "new content", "original");
    });

    expect(result.current.getDraft("kb/note.md", "original")).toBe("new content");
    expect(result.current.getSaveState("kb/note.md")).toBe("dirty");
  });

  it("autosave dispara tras debounce y termina en saved", async () => {
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
    expect(onSave).toHaveBeenCalledWith("kb/note.md", "autosaved");
    expect(result.current.getSaveState("kb/note.md")).toBe("saved");
    expect(result.current.getSaveError("kb/note.md")).toBeNull();
  });

  it("save fallido pone state=error con mensaje", async () => {
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

  it("clearDraft cancela timer, borra draft y resetea a idle", async () => {
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

  it("ediciones rapidas solo salvan la ultima", async () => {
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
    expect(onSave).toHaveBeenCalledWith("kb/note.md", "second");
    expect(result.current.getSaveState("kb/note.md")).toBe("saved");
  });

  it("onSave usa la referencia mas reciente cuando cambia entre schedule y fire", async () => {
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
    expect(secondOnSave).toHaveBeenCalledWith("kb/note.md", "value");
  });

  it("no save cuando content === baseline", async () => {
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
