import type { MessagePart, ToolState } from "@/lib/opencode/types";

/**
 * Internal-only parts that should be completely hidden.
 * These are OpenCode internals that have no user-facing value.
 */
const HIDDEN_PART_TYPES = new Set(["snapshot", "compaction"]);

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
          const input = (state?.input ?? {}) as Record<string, unknown>;

          if (status === "completed") {
            toolState = {
              status: "completed",
              input,
              output: String(state?.output ?? ""),
              title: String(state?.title ?? toolName),
            };
          } else if (status === "error") {
            toolState = {
              status: "error",
              input,
              error: String(state?.error ?? "Unknown error"),
            };
          } else if (status === "running") {
            toolState = {
              status: "running",
              input,
              title: state?.title ? String(state.title) : undefined,
            };
          } else {
            toolState = { status: "pending", input };
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

          let resolvedPath = sourcePath;
          if (!resolvedPath && fileUrl?.startsWith("file:///workspace/")) {
            try {
              resolvedPath = decodeURIComponent(
                fileUrl.slice("file:///workspace/".length)
              );
            } catch {
              resolvedPath = fileUrl.slice("file:///workspace/".length);
            }
          }
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
          return {
            type: "unknown" as const,
            originalType: partType,
            data: part as Record<string, unknown>,
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
