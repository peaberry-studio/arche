"use client";

import { useCallback, useState } from "react";
import {
  loadFileTreeAction,
  readFileAction,
} from "@/actions/opencode";
import {
  readWorkspaceFileAction,
  writeWorkspaceFileAction,
  deleteWorkspaceFileAction,
  applyWorkspacePatchAction,
  discardWorkspaceFileChangesAction,
} from "@/actions/workspace-agent";
import type { WorkspaceFileNode } from "@/lib/opencode/types";

export type UseWorkspaceFilesReturn = {
  fileTree: WorkspaceFileNode[];
  isLoadingFiles: boolean;
  refreshFiles: () => Promise<void>;
  readFile: (
    path: string
  ) => Promise<{ content: string; type: "raw" | "patch"; hash?: string } | null>;
  writeFile: (
    path: string,
    content: string,
    expectedHash?: string
  ) => Promise<{ ok: boolean; hash?: string; error?: string }>;
  deleteFile: (path: string) => Promise<boolean>;
  applyPatch: (patch: string) => Promise<boolean>;
  discardFileChanges: (path: string) => Promise<{ ok: boolean; error?: string }>;
};

export function useWorkspaceFiles(slug: string): UseWorkspaceFilesReturn {
  const [fileTree, setFileTree] = useState<WorkspaceFileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const refreshFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const result = await loadFileTreeAction(slug);
      if (result.ok && result.tree) {
        setFileTree(result.tree);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  }, [slug]);

  const readFile = useCallback(
    async (path: string) => {
      const agentResult = await readWorkspaceFileAction(slug, path);
      if (agentResult.ok && agentResult.content) {
        return {
          content: agentResult.content.content,
          type: agentResult.content.type,
          hash: agentResult.hash,
        };
      }

      const result = await readFileAction(slug, path);
      if (result.ok && result.content) {
        return { content: result.content.content, type: result.content.type };
      }

      return null;
    },
    [slug]
  );

  const writeFile = useCallback(
    async (path: string, content: string, expectedHash?: string) => {
      const result = await writeWorkspaceFileAction(
        slug,
        path,
        content,
        expectedHash
      );
      if (result.ok) {
        return { ok: true, hash: result.hash };
      }
      return { ok: false, error: result.error };
    },
    [slug]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      const result = await deleteWorkspaceFileAction(slug, path);
      return result.ok;
    },
    [slug]
  );

  const applyPatch = useCallback(
    async (patch: string) => {
      const result = await applyWorkspacePatchAction(slug, patch);
      return result.ok;
    },
    [slug]
  );

  const discardFileChanges = useCallback(
    async (path: string) => {
      try {
        const result = await discardWorkspaceFileChangesAction(slug, path);
        return result;
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "discard_failed",
        };
      }
    },
    [slug]
  );

  return {
    fileTree,
    isLoadingFiles,
    refreshFiles,
    readFile,
    writeFile,
    deleteFile,
    applyPatch,
    discardFileChanges,
  };
}
