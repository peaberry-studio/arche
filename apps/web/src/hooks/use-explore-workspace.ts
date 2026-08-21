"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useWorkspaceConnection } from "@/hooks/use-workspace-connection";
import type { WorkspaceDiff } from "@/hooks/use-workspace-diffs";
import { useWorkspaceDiffs } from "@/hooks/use-workspace-diffs";
import { useWorkspaceFiles } from "@/hooks/use-workspace-files";
import { useInstanceHeartbeat } from "@/hooks/use-instance-heartbeat";
import { downloadWorkspaceFile } from "@/lib/workspace-file-download";
import {
  exportWorkspaceFile,
  type WorkspaceFileExportFormat,
} from "@/lib/workspace-file-export";
import { flattenWorkspaceFileNodes } from "@/lib/workspace-file-search";
import {
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";

type FileContentCache = Record<
  string,
  {
    content: string;
    type: "raw" | "patch";
    title: string;
    updatedAt: string;
    size: string;
    hash?: string;
  }
>;

export type ExploreWorkspaceFile = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
  size: string;
  hash?: string;
  kind: "markdown" | "text";
};

type StoredOpenFilesState = {
  openFilePaths: string[];
  activeFilePath: string | null;
};

export type UseExploreWorkspaceOptions = {
  slug: string;
  storageScope: string;
  initialFilePath?: string | null;
  workspaceAgentEnabled?: boolean;
  enabled?: boolean;
  reaperEnabled?: boolean;
};

export type UseExploreWorkspaceReturn = {
  connection: ReturnType<typeof useWorkspaceConnection>["connection"];
  isConnected: boolean;
  fileTree: ReturnType<typeof useWorkspaceFiles>["fileTree"];
  isLoadingFiles: boolean;
  refreshFiles: () => Promise<void>;
  readFile: ReturnType<typeof useWorkspaceFiles>["readFile"];
  diffs: WorkspaceDiff[];
  isLoadingDiffs: boolean;
  diffsError: string | null;
  refreshDiffs: (options?: { force?: boolean }) => Promise<void>;
  openFiles: ExploreWorkspaceFile[];
  openFilePaths: string[];
  activeFilePath: string | null;
  markdownFilePaths: string[];
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onOpenFile: (path: string) => Promise<void>;
  onSaveFile: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
  onReloadFile: (path: string) => Promise<void>;
  onDiscardFileChanges: (
    path: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onResolveConflict: (path: string) => Promise<void>;
  onPublish: () => void;
  onDownloadFile: (path: string) => void;
  onExportFileDocx: (path: string) => Promise<void>;
  onExportFilePdf: (path: string) => Promise<void>;
};

function getOpenFilesStorageKey(scope: string): string {
  return `arche.workspace.${scope}.open-files`;
}

const MAX_STORED_OPEN_FILES = 50;

function isValidStoredPath(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return false;
  if (isProtectedWorkspacePath(normalized)) return false;
  if (normalized.split("/").some((s) => s === "..")) return false;
  return true;
}

function loadStoredOpenFiles(key: string): StoredOpenFilesState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.openFilePaths)) return null;
    const seen = new Set<string>();
    const openFilePaths: string[] = [];
    for (const entry of record.openFilePaths) {
      if (!isValidStoredPath(entry)) continue;
      const normalized = normalizeWorkspacePath(entry);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      openFilePaths.push(normalized);
      if (openFilePaths.length >= MAX_STORED_OPEN_FILES) break;
    }
    if (openFilePaths.length === 0) return null;
    const activeFilePath =
      isValidStoredPath(record.activeFilePath) && openFilePaths.includes(normalizeWorkspacePath(record.activeFilePath as string))
        ? normalizeWorkspacePath(record.activeFilePath as string)
        : null;
    return { openFilePaths, activeFilePath };
  } catch {
    return null;
  }
}

function persistOpenFiles(key: string, state: StoredOpenFilesState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

const ERROR_CONTENT = "Unable to load file.";

function toCachedFile(
  path: string,
  result: { content: string; type: "raw" | "patch"; hash?: string }
): FileContentCache[string] {
  return {
    content: result.content,
    type: result.type,
    title: path.split("/").pop() ?? path,
    updatedAt: "Just now",
    size: `${(result.content.length / 1024).toFixed(1)} KB`,
    hash: result.hash,
  };
}

function toErrorCachedFile(path: string): FileContentCache[string] {
  return {
    content: ERROR_CONTENT,
    type: "raw",
    title: path.split("/").pop() ?? path,
    updatedAt: "Error",
    size: "0 KB",
  };
}

export function useExploreWorkspace({
  slug,
  storageScope,
  initialFilePath = null,
  workspaceAgentEnabled = true,
  enabled = true,
  reaperEnabled = true,
}: UseExploreWorkspaceOptions): UseExploreWorkspaceReturn {
  const { connection, isConnected } = useWorkspaceConnection(slug, enabled);
  const files = useWorkspaceFiles(slug, workspaceAgentEnabled);
  const { refreshFiles } = files;
  const { diffs, isLoadingDiffs, diffsError, refreshDiffs } = useWorkspaceDiffs(
    slug,
    enabled && workspaceAgentEnabled,
    isConnected
  );
  useInstanceHeartbeat(slug, enabled && reaperEnabled);

  useEffect(() => {
    if (!isConnected) return;
    void refreshFiles();
  }, [isConnected, refreshFiles]);

  const openFilesStorageKey = getOpenFilesStorageKey(storageScope);

  const safeInitialFilePath = useMemo(() => {
    if (!initialFilePath) return null;
    if (!isValidStoredPath(initialFilePath)) return null;
    return normalizeWorkspacePath(initialFilePath);
  }, [initialFilePath]);

  const [openFilePaths, setOpenFilePaths] = useState<string[]>(() => {
    const stored = loadStoredOpenFiles(openFilesStorageKey);
    const storedPaths = stored?.openFilePaths ?? [];
    if (!safeInitialFilePath) return storedPaths;
    if (storedPaths.includes(safeInitialFilePath)) return storedPaths;
    return [...storedPaths, safeInitialFilePath];
  });
  const [activeFilePath, setActiveFilePath] = useState<string | null>(() => {
    if (safeInitialFilePath) return safeInitialFilePath;
    const stored = loadStoredOpenFiles(openFilesStorageKey);
    if (!stored?.activeFilePath) return stored?.openFilePaths?.[0] ?? null;
    return stored.openFilePaths.includes(stored.activeFilePath)
      ? stored.activeFilePath
      : stored.openFilePaths[0] ?? null;
  });
  const [fileCache, setFileCache] = useState<FileContentCache>({});
  const fileCacheRef = useRef(fileCache);

  useEffect(() => {
    fileCacheRef.current = fileCache;
  }, [fileCache]);

  const initialOpenFilePathsRef = useRef(openFilePaths);
  const hasRestoredFilesRef = useRef(false);
  useEffect(() => {
    if (hasRestoredFilesRef.current) return;
    if (!isConnected) return;
    const paths = initialOpenFilePathsRef.current;
    if (paths.length === 0) {
      hasRestoredFilesRef.current = true;
      return;
    }
    hasRestoredFilesRef.current = true;

    void Promise.all(
      paths.map(async (path) => {
        try {
          const result = await files.readFile(path);
          setFileCache((prev) => {
            if (prev[path]) return prev;
            return {
              ...prev,
              [path]: result ? toCachedFile(path, result) : toErrorCachedFile(path),
            };
          });
        } catch {
          setFileCache((prev) => ({
            ...prev,
            [path]: toErrorCachedFile(path),
          }));
        }
      })
    );
  }, [files, isConnected]);

  useEffect(() => {
    persistOpenFiles(openFilesStorageKey, { openFilePaths, activeFilePath });
  }, [openFilesStorageKey, openFilePaths, activeFilePath]);

  const flattenedFilePaths = useMemo(
    () => flattenWorkspaceFileNodes(files.fileTree).map((file) => file.path),
    [files.fileTree]
  );

  const filePathSet = useMemo(() => new Set(flattenedFilePaths), [flattenedFilePaths]);
  const markdownFilePaths = useMemo(
    () => flattenedFilePaths.filter((path) => path.toLowerCase().endsWith(".md")),
    [flattenedFilePaths]
  );

  const normalizePath = useCallback((path: string) => {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  }, []);

  const resolveFilePath = useCallback(
    (path: string) => {
      if (!path) return path;
      const normalized = normalizePath(path);
      if (filePathSet.has(normalized)) return normalized;

      const trimmed = normalized.replace(/^\/+/, "");
      if (filePathSet.has(trimmed)) return trimmed;

      const matches = flattenedFilePaths.filter((candidate) =>
        normalized.endsWith(candidate) || trimmed.endsWith(candidate)
      );
      if (matches.length === 0) return normalized;

      matches.sort((a, b) => b.length - a.length);
      return matches[0];
    },
    [filePathSet, flattenedFilePaths, normalizePath]
  );

  const diffSignature = useMemo(() => {
    if (diffs.length === 0) return "";
    return diffs
      .map(
        (entry) =>
          `${entry.path}:${entry.status}:${entry.additions}:${entry.deletions}:${entry.conflicted ? 1 : 0}:${entry.diff}`
      )
      .sort()
      .join("|");
  }, [diffs]);

  const lastDiffSignatureRef = useRef("");

  useEffect(() => {
    if (!isConnected) return;
    if (lastDiffSignatureRef.current === diffSignature) return;

    lastDiffSignatureRef.current = diffSignature;
    void files.refreshFiles();

    if (openFilePaths.length === 0) return;

    openFilePaths.forEach((path) => {
      void files.readFile(path).then((result) => {
        if (!result) return;
        setFileCache((prev) => ({
          ...prev,
          [path]: toCachedFile(path, result),
        }));
      });
    });
  }, [diffSignature, files, isConnected, openFilePaths]);

  const onSaveFile = useCallback(
    async (path: string, content: string, expectedHash?: string) => {
      const hashToUse = expectedHash ?? fileCacheRef.current[path]?.hash;
      const result = await files.writeFile(path, content, hashToUse);
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "save_failed" };
      }

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        const size = `${(content.length / 1024).toFixed(1)} KB`;
        return {
          ...prev,
          [path]: {
            ...existing,
            content,
            updatedAt: "Just now",
            size,
            hash: result.hash ?? existing.hash,
          },
        };
      });

      void refreshDiffs();
      void files.refreshFiles();

      return { ok: true as const, hash: result.hash };
    },
    [files, refreshDiffs]
  );

  const onReloadFile = useCallback(
    async (path: string) => {
      const result = await files.readFile(path);
      if (!result) return;

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        return {
          ...prev,
          [path]: {
            ...existing,
            ...toCachedFile(path, result),
          },
        };
      });
    },
    [files]
  );

  const onDiscardFileChanges = useCallback(
    async (path: string) => {
      const result = await files.discardFileChanges(path);
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "discard_failed" };
      }

      const refreshed = await files.readFile(path);

      setFileCache((prev) => {
        const next = { ...prev };
        if (!refreshed) {
          delete next[path];
          return next;
        }
        const existing = next[path];
        if (!existing) return prev;

        next[path] = {
          ...existing,
          ...toCachedFile(path, refreshed),
        };
        return next;
      });

      if (!refreshed) {
        setOpenFilePaths((prev) => {
          const nextOpen = prev.filter((candidate) => candidate !== path);
          setActiveFilePath((active) => {
            if (active !== path) return active;
            return nextOpen[0] ?? null;
          });
          return nextOpen;
        });
      }

      void refreshDiffs();
      void files.refreshFiles();

      return { ok: true as const };
    },
    [files, refreshDiffs]
  );

  const onResolveConflict = useCallback(
    async (path: string) => {
      void refreshDiffs();

      if (!fileCacheRef.current[path]) return;

      const refreshed = await files.readFile(path);

      setFileCache((prev) => {
        const existing = prev[path];
        if (!existing) return prev;
        if (!refreshed) {
          const next = { ...prev };
          delete next[path];
          return next;
        }
        return {
          ...prev,
          [path]: {
            ...existing,
            ...toCachedFile(path, refreshed),
          },
        };
      });

      if (!refreshed) {
        setOpenFilePaths((prev) => {
          const nextOpen = prev.filter((candidate) => candidate !== path);
          setActiveFilePath((active) => {
            if (active !== path) return active;
            return nextOpen[0] ?? null;
          });
          return nextOpen;
        });
      }
    },
    [files, refreshDiffs]
  );

  const onPublish = useCallback(() => {
    void refreshDiffs();
    void files.refreshFiles();
  }, [files, refreshDiffs]);

  const openFiles = useMemo<ExploreWorkspaceFile[]>(() => {
    return openFilePaths
      .map((path) => {
        const cached = fileCache[path];
        if (!cached) return null;
        return {
          path,
          title: path.split("/").pop() ?? path,
          content: cached.content,
          updatedAt: cached.updatedAt,
          size: cached.size,
          hash: cached.hash,
          kind: path.endsWith(".md") ? "markdown" as const : "text" as const,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
  }, [openFilePaths, fileCache]);

  const onSelectFile = useCallback((path: string) => {
    setActiveFilePath(path);
  }, []);

  const onCloseFile = useCallback((path: string) => {
    setOpenFilePaths((prev) => {
      const filtered = prev.filter((p) => p !== path);
      if (path === activeFilePath) {
        setActiveFilePath(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }
      return filtered;
    });
  }, [activeFilePath]);

  const onOpenFile = useCallback(
    async (path: string) => {
      const resolvedPath = resolveFilePath(path);
      const pathToOpen = resolvedPath || path;
      const normalizedPath = normalizeWorkspacePath(pathToOpen);

      if (!normalizedPath || isProtectedWorkspacePath(normalizedPath)) {
        return;
      }

      setOpenFilePaths((prev) => (prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]));
      setActiveFilePath(normalizedPath);

      if (!fileCacheRef.current[normalizedPath]) {
        try {
          const result = await files.readFile(normalizedPath);
          setFileCache((prev) => ({
            ...prev,
            [normalizedPath]: result ? toCachedFile(normalizedPath, result) : toErrorCachedFile(normalizedPath),
          }));
        } catch {
          setFileCache((prev) => ({
            ...prev,
            [normalizedPath]: toErrorCachedFile(normalizedPath),
          }));
        }
      }
    },
    [files, resolveFilePath]
  );

  const onDownloadFile = useCallback(
    (path: string) => {
      downloadWorkspaceFile(slug, path);
    },
    [slug]
  );

  const onExportFile = useCallback(
    async (format: WorkspaceFileExportFormat, path: string) => {
      const label = format.toUpperCase();
      const toastId = `${format}-export:${path}`;
      toast.loading(`Exporting ${label}…`, { id: toastId });
      const result = await exportWorkspaceFile(slug, path, format);
      if (result.ok) {
        toast.success(`${label} exported`, { id: toastId });
      } else if (result.error === "export_busy") {
        toast.error(`Another ${label} export is already in progress`, { id: toastId });
      } else if (result.error === "file_too_large") {
        toast.error("The document is too large to export", { id: toastId });
      } else if (result.error === "bundle_too_large") {
        toast.error("The document bundle is too large to export", { id: toastId });
      } else if (result.error === "export_timeout") {
        toast.error(`${label} export timed out; try again`, { id: toastId });
      } else {
        toast.error(`${label} export failed`, { id: toastId });
      }
    },
    [slug]
  );

  const onExportFileDocx = useCallback(
    (path: string) => onExportFile("docx", path),
    [onExportFile]
  );
  const onExportFilePdf = useCallback(
    (path: string) => onExportFile("pdf", path),
    [onExportFile]
  );

  return {
    connection,
    isConnected,
    fileTree: files.fileTree,
    isLoadingFiles: files.isLoadingFiles,
    refreshFiles: files.refreshFiles,
    readFile: files.readFile,
    diffs,
    isLoadingDiffs,
    diffsError,
    refreshDiffs,
    openFilePaths,
    activeFilePath,
    openFiles,
    markdownFilePaths,
    onSelectFile,
    onCloseFile,
    onOpenFile,
    onSaveFile,
    onReloadFile,
    onDiscardFileChanges,
    onResolveConflict,
    onPublish,
    onDownloadFile,
    onExportFileDocx,
    onExportFilePdf,
  };
}
