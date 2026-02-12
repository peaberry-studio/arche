"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type SaveResult = { ok: true; hash?: string } | { ok: false; error: string };

type EditorDraftsConfig = {
  onSave:
    | ((path: string, content: string, expectedHash?: string) => Promise<SaveResult>)
    | undefined;
  debounceMs?: number;
};

type UseEditorDraftsReturn = {
  getDraft: (path: string, fallback: string) => string;
  getSaveState: (path: string) => SaveState;
  getSaveError: (path: string) => string | null;
  handleChange: (
    path: string,
    content: string,
    sourceContent: string,
    sourceHash?: string
  ) => void;
  clearDraft: (path: string) => void;
};

export function useEditorDrafts(config: EditorDraftsConfig): UseEditorDraftsReturn {
  const debounceMs = config.debounceMs ?? 600;

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [saveError, setSaveError] = useState<Record<string, string | null>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const draftsRef = useRef(drafts);

  const lastSavedRef = useRef(lastSaved);
  const baseContentRef = useRef<Record<string, string>>({});
  const baseHashRef = useRef<Record<string, string | undefined>>({});

  const onSaveRef = useRef(config.onSave);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    lastSavedRef.current = lastSaved;
  }, [lastSaved]);

  useEffect(() => {
    onSaveRef.current = config.onSave;
  }, [config.onSave]);

  const clearTimer = useCallback((path: string) => {
    const timer = saveTimersRef.current[path];
    if (timer) {
      clearTimeout(timer);
      saveTimersRef.current[path] = null;
    }
  }, []);

  const scheduleAutosave = useCallback(
    (path: string, content: string, baseline: string, expectedHash?: string) => {
      if (!onSaveRef.current) return;

      clearTimer(path);

      saveTimersRef.current[path] = setTimeout(async () => {
        saveTimersRef.current[path] = null;

        if (baseline === content) {
          setSaveState((prev) => ({ ...prev, [path]: "idle" }));
          setSaveError((prev) => ({ ...prev, [path]: null }));
          return;
        }

        setSaveState((prev) => ({ ...prev, [path]: "saving" }));
        setSaveError((prev) => ({ ...prev, [path]: null }));

        const onSave = onSaveRef.current;
        if (!onSave) {
          setSaveState((prev) => ({ ...prev, [path]: "dirty" }));
          return;
        }

        const result = await onSave(path, content, expectedHash);
        if (result.ok) {
          setLastSaved((prev) => ({ ...prev, [path]: content }));
          baseContentRef.current[path] = content;
          baseHashRef.current[path] = result.hash;
          setSaveState((prev) => ({ ...prev, [path]: "saved" }));
          setSaveError((prev) => ({ ...prev, [path]: null }));
          return;
        }

        setSaveState((prev) => ({ ...prev, [path]: "error" }));
        setSaveError((prev) => ({ ...prev, [path]: result.error }));
      }, debounceMs);
    },
    [clearTimer, debounceMs]
  );

  const handleChange = useCallback(
    (path: string, content: string, sourceContent: string, sourceHash?: string) => {
      const hasDraft = typeof draftsRef.current[path] === "string";
      if (!hasDraft) {
        const baseline = lastSavedRef.current[path] ?? sourceContent;
        baseContentRef.current[path] = baseline;
        if (baseHashRef.current[path] === undefined) {
          baseHashRef.current[path] = sourceHash;
        }
      }

      const baseline = baseContentRef.current[path] ?? lastSavedRef.current[path] ?? sourceContent;
      const expectedHash = baseHashRef.current[path];

      setDrafts((prev) => ({ ...prev, [path]: content }));
      setSaveError((prev) => ({ ...prev, [path]: null }));

      if (content === baseline) {
        clearTimer(path);
        setSaveState((prev) => ({ ...prev, [path]: "idle" }));
        return;
      }

      setSaveState((prev) => ({ ...prev, [path]: "dirty" }));
      scheduleAutosave(path, content, baseline, expectedHash);
    },
    [clearTimer, scheduleAutosave]
  );

  const clearDraft = useCallback((path: string) => {
    const timer = saveTimersRef.current[path];
    if (timer) {
      clearTimeout(timer);
      saveTimersRef.current[path] = null;
    }

    setDrafts((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setLastSaved((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    delete baseContentRef.current[path];
    delete baseHashRef.current[path];
    setSaveState((prev) => ({ ...prev, [path]: "idle" }));
    setSaveError((prev) => ({ ...prev, [path]: null }));
  }, []);

  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const getDraft = useCallback((path: string, fallback: string) => {
    return drafts[path] ?? fallback;
  }, [drafts]);

  const getSaveState = useCallback((path: string) => {
    return saveState[path] ?? "idle";
  }, [saveState]);

  const getSaveError = useCallback((path: string) => {
    return saveError[path] ?? null;
  }, [saveError]);

  return useMemo(
    () => ({
      getDraft,
      getSaveState,
      getSaveError,
      handleChange,
      clearDraft,
    }),
    [clearDraft, getDraft, getSaveError, getSaveState, handleChange]
  );
}
