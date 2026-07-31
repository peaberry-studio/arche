// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollPositions } from "@/hooks/use-scroll-positions";

const STORAGE_KEY = "arche.workspace.test.scroll-positions";

describe("useScrollPositions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getScrollTop returns 0 for unknown paths", () => {
    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));
    expect(result.current.getScrollTop("kb/note.md")).toBe(0);
  });

  it("setScrollTop stores value retrievable by getScrollTop", () => {
    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));

    act(() => {
      result.current.setScrollTop("kb/note.md", 500);
    });

    expect(result.current.getScrollTop("kb/note.md")).toBe(500);
  });

  it("clearScrollTop removes the entry", () => {
    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));

    act(() => {
      result.current.setScrollTop("kb/note.md", 300);
    });
    expect(result.current.getScrollTop("kb/note.md")).toBe(300);

    act(() => {
      result.current.clearScrollTop("kb/note.md");
    });
    expect(result.current.getScrollTop("kb/note.md")).toBe(0);
  });

  it("debounces localStorage writes", () => {
    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));

    act(() => {
      result.current.setScrollTop("kb/a.md", 100);
      result.current.setScrollTop("kb/a.md", 200);
      result.current.setScrollTop("kb/a.md", 300);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["kb/a.md"]).toBe(300);
  });

  it("loads persisted positions from localStorage on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "kb/note.md": 450, "kb/other.md": 120 })
    );

    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));

    expect(result.current.getScrollTop("kb/note.md")).toBe(450);
    expect(result.current.getScrollTop("kb/other.md")).toBe(120);
  });

  it("handles invalid localStorage data gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const { result: r1 } = renderHook(() => useScrollPositions(STORAGE_KEY + "-1"));

    localStorage.setItem(STORAGE_KEY + "-2", JSON.stringify([1, 2, 3]));
    const { result: r2 } = renderHook(() => useScrollPositions(STORAGE_KEY + "-2"));

    localStorage.setItem(
      STORAGE_KEY + "-3",
      JSON.stringify({ "kb/a.md": "not-a-number", "kb/b.md": 100 })
    );
    const { result: r3 } = renderHook(() => useScrollPositions(STORAGE_KEY + "-3"));

    expect(r1.current.getScrollTop("kb/x.md")).toBe(0);
    expect(r2.current.getScrollTop("kb/x.md")).toBe(0);
    expect(r3.current.getScrollTop("kb/a.md")).toBe(0);
    expect(r3.current.getScrollTop("kb/b.md")).toBe(100);
  });

  it("discards zero and negative values from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "kb/zero.md": 0, "kb/neg.md": -10, "kb/ok.md": 50 })
    );

    const { result } = renderHook(() => useScrollPositions(STORAGE_KEY));

    expect(result.current.getScrollTop("kb/zero.md")).toBe(0);
    expect(result.current.getScrollTop("kb/neg.md")).toBe(0);
    expect(result.current.getScrollTop("kb/ok.md")).toBe(50);
  });

  it("flushes to localStorage on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useScrollPositions(STORAGE_KEY)
    );

    act(() => {
      result.current.setScrollTop("kb/note.md", 999);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["kb/note.md"]).toBe(999);
  });

  it("separate storage keys are independent", () => {
    const key1 = STORAGE_KEY + "-a";
    const key2 = STORAGE_KEY + "-b";

    const { result: r1 } = renderHook(() => useScrollPositions(key1));
    const { result: r2 } = renderHook(() => useScrollPositions(key2));

    act(() => {
      r1.current.setScrollTop("kb/note.md", 100);
      r2.current.setScrollTop("kb/note.md", 200);
    });

    expect(r1.current.getScrollTop("kb/note.md")).toBe(100);
    expect(r2.current.getScrollTop("kb/note.md")).toBe(200);
  });
});
