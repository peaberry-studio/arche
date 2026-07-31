"use client";

import { useCallback, useEffect, useRef } from "react";

const DEBOUNCE_MS = 2000;

type UseScrollPositionsReturn = {
  getScrollTop: (path: string) => number;
  setScrollTop: (path: string, value: number) => void;
  clearScrollTop: (path: string) => void;
};

function loadPositions(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        result[k] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function persistPositions(
  key: string,
  positions: Record<string, number>
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(positions));
  } catch {
    // ignore storage errors (quota, private browsing)
  }
}

export function useScrollPositions(
  storageKey: string
): UseScrollPositionsReturn {
  const positionsRef = useRef<Record<string, number>>(
    loadPositions(storageKey)
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKeyRef = useRef(storageKey);
  useEffect(() => {
    storageKeyRef.current = storageKey;
  }, [storageKey]);

  const schedulePersist = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      persistPositions(storageKeyRef.current, positionsRef.current);
    }, DEBOUNCE_MS);
  }, []);

  const getScrollTop = useCallback((path: string): number => {
    return positionsRef.current[path] ?? 0;
  }, []);

  const setScrollTop = useCallback(
    (path: string, value: number): void => {
      positionsRef.current[path] = value;
      schedulePersist();
    },
    [schedulePersist]
  );

  const clearScrollTop = useCallback(
    (path: string): void => {
      delete positionsRef.current[path];
      schedulePersist();
    },
    [schedulePersist]
  );

  useEffect(() => {
    const positions = positionsRef;
    const timer = timerRef;
    const key = storageKeyRef;
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      persistPositions(key.current, positions.current);
    };
  }, []);

  return { getScrollTop, setScrollTop, clearScrollTop };
}
