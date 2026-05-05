import type { MessagePart, ToolState } from "@/lib/opencode/types";
import { WORKSPACE_ATTACHMENTS_DIR } from "@/lib/workspace-attachments";

/**
 * Internal-only parts that should be completely hidden.
 * These are OpenCode internals that have no user-facing value.
 */
const HIDDEN_PART_TYPES = new Set(["snapshot", "compaction"]);

function resolveFilePartPath(sourcePath: string | undefined, fileUrl: string | undefined): string | undefined {
  if (sourcePath) {
    return sourcePath;
  }

  if (!fileUrl?.startsWith("file://")) {
    return undefined;
  }

  const candidates: string[] = [];
  try {
    candidates.push(decodeURIComponent(new URL(fileUrl).pathname));
  } catch {
    // Fall back to the raw URL string below.
  }
  candidates.push(fileUrl.slice("file://".length));

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/\\/g, "/");
    if (candidate.startsWith("/workspace/")) {
      return candidate.slice("/workspace/".length);
    }

    const attachmentMarker = `/${WORKSPACE_ATTACHMENTS_DIR}/`;
    const attachmentIndex = candidate.indexOf(attachmentMarker);
    if (attachmentIndex >= 0) {
      return candidate.slice(attachmentIndex + 1);
    }
  }

  return undefined;
}

function normalizeSerializableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeSerializableValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      normalizeSerializableValue(entry),
    ])
  );
}

/**
 * Transform OpenCode parts to UI-friendly MessagePart types.
 * Unknown types are preserved with 'unknown' type for debugging.
 */
export function transformParts(parts: unknown[]): MessagePart[] {
  const mapped = parts
    .map((p): MessagePart | null => {
      const part = p as Record<string, unknown>;
      const partType = String(part.type ?? "unknown");
      const partId = String(part.id ?? `part-${Date.now()}`);

      // Completely hide internal parts
      if (HIDDEN_PART_TYPES.has(partType)) {
        return null;
      }

      switch (partType) {
        case "text": {
          const text = String(part.text ?? "");
          // Skip empty text parts
          if (!text.trim()) return null;
          return { type: "text" as const, id: partId, text };
        }

        case "reasoning": {
          const text = String(part.text ?? "");
          // Skip empty reasoning
          if (!text.trim()) return null;
          return { type: "reasoning" as const, id: partId, text };
        }

        case "tool": {
          const state = part.state as Record<string, unknown> | undefined;
          const toolName = String(part.tool ?? "unknown");

          // Map state to our ToolState type
          let toolState: ToolState;
          const status = String(state?.status ?? "pending");
          const normalizedInput = normalizeSerializableValue(state?.input ?? {});
          const input =
            normalizedInput && typeof normalizedInput === "object" && !Array.isArray(normalizedInput)
              ? (normalizedInput as Record<string, unknown>)
              : {};
          const normalizedMetadata = normalizeSerializableValue(state?.metadata);
          const metadata =
            normalizedMetadata && typeof normalizedMetadata === "object" && !Array.isArray(normalizedMetadata)
              ? (normalizedMetadata as Record<string, unknown>)
              : undefined;
          const metadataProps = metadata ? { metadata } : {};

          if (status === "completed") {
            toolState = {
              status: "completed",
              input,
              output: String(state?.output ?? ""),
              title: String(state?.title ?? toolName),
              ...metadataProps,
            };
          } else if (status === "error") {
            toolState = {
              status: "error",
              input,
              error: String(state?.error ?? "Unknown error"),
              ...metadataProps,
            };
          } else if (status === "running") {
            toolState = {
              status: "running",
              input,
              title: state?.title ? String(state.title) : undefined,
              ...metadataProps,
            };
          } else {
            toolState = { status: "pending", input, ...metadataProps };
          }

          return {
            type: "tool" as const,
            id: String(part.callID ?? partId),
            name: toolName,
            state: toolState,
          };
        }

        case "file": {
          const source = part.source as Record<string, unknown> | undefined;
          const sourcePath =
            typeof part.path === "string"
              ? part.path
              : typeof source?.path === "string"
              ? source.path
              : undefined;
          const fileUrl = part.url ? String(part.url) : undefined;

          const resolvedPath = resolveFilePartPath(sourcePath, fileUrl);
          return {
            type: "file" as const,
            id: partId,
            path: String(resolvedPath ?? ""),
            filename: part.filename ? String(part.filename) : undefined,
            mime: part.mime ? String(part.mime) : undefined,
            url: fileUrl,
          };
        }

        case "image": {
          return {
            type: "image" as const,
            id: partId,
            url: String(part.url ?? ""),
          };
        }

        case "step-start": {
          return {
            type: "step-start" as const,
            id: partId,
            snapshot: part.snapshot ? String(part.snapshot) : undefined,
          };
        }

        case "step-finish": {
          const tokens = part.tokens as Record<string, number> | undefined;
          return {
            type: "step-finish" as const,
            id: partId,
            reason: String(part.reason ?? ""),
            cost: Number(part.cost ?? 0),
            tokens: {
              input: Number(tokens?.input ?? 0),
              output: Number(tokens?.output ?? 0),
            },
          };
        }

        case "patch": {
          return {
            type: "patch" as const,
            id: partId,
            files: Array.isArray(part.files) ? part.files.map(String) : [],
          };
        }

        case "agent": {
          return {
            type: "agent" as const,
            id: partId,
            name: String(part.name ?? "unknown"),
          };
        }

        case "subtask": {
          return {
            type: "subtask" as const,
            id: partId,
            prompt: String(part.prompt ?? ""),
            description: String(part.description ?? ""),
            agent: String(part.agent ?? "unknown"),
          };
        }

        case "retry": {
          const error = part.error as Record<string, unknown> | undefined;
          const errorData = error?.data as Record<string, unknown> | undefined;
          return {
            type: "retry" as const,
            id: partId,
            attempt: Number(part.attempt ?? 0),
            error: String(errorData?.message ?? error?.message ?? "Unknown error"),
          };
        }

        default: {
          // Unknown type - preserve as fallback for debugging
          console.log("[transformParts] Unknown part type:", partType, part);
          const normalizedData = normalizeSerializableValue(part);
          return {
            type: "unknown" as const,
            originalType: partType,
            data:
              normalizedData && typeof normalizedData === "object" && !Array.isArray(normalizedData)
                ? (normalizedData as Record<string, unknown>)
                : { value: normalizedData },
          };
        }
      }
    });
  return mapped.filter((p): p is MessagePart => p !== null);
}

export function extractTextContent(parts: MessagePart[]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } | { type: "reasoning"; text: string } =>
        p.type === "text" || p.type === "reasoning"
    )
    .map((p) => p.text)
    .join("\n");
}
