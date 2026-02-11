"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type SaveResult = { ok: true; hash?: string } | { ok: false; error: string };

type EditorDraftsConfig = {
  onSave: ((path: string, content: string) => Promise<SaveResult>) | undefined;
  debounceMs?: number;
};

type UseEditorDraftsReturn = {
  getDraft: (path: string, fallback: string) => string;
  getSaveState: (path: string) => SaveState;
  getSaveError: (path: string) => string | null;
  handleChange: (path: string, content: string, sourceContent: string) => void;
  clearDraft: (path: string) => void;
};

export function useEditorDrafts(config: EditorDraftsConfig): UseEditorDraftsReturn {
  const debounceMs = config.debounceMs ?? 600;

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastSaved, setLastSaved] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [saveError, setSaveError] = useState<Record<string, string | null>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const lastSavedRef = useRef(lastSaved);

  const onSaveRef = useRef(config.onSave);

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
    (path: string, content: string, sourceContent: string) => {
      if (!onSaveRef.current) return;

      clearTimer(path);

      saveTimersRef.current[path] = setTimeout(async () => {
        saveTimersRef.current[path] = null;

        const baseline = lastSavedRef.current[path] ?? sourceContent;
        if (baseline === content) {
          setSaveState((prev) => ({ ...prev, [path]: "saved" }));
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

        const result = await onSave(path, content);
        if (result.ok) {
          setLastSaved((prev) => ({ ...prev, [path]: content }));
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
    (path: string, content: string, sourceContent: string) => {
      const baseline = lastSavedRef.current[path] ?? sourceContent;

      setDrafts((prev) => ({ ...prev, [path]: content }));
      setSaveError((prev) => ({ ...prev, [path]: null }));

      if (content === baseline) {
        clearTimer(path);
        setSaveState((prev) => ({ ...prev, [path]: "idle" }));
        return;
      }

      setSaveState((prev) => ({ ...prev, [path]: "dirty" }));
      scheduleAutosave(path, content, sourceContent);
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
