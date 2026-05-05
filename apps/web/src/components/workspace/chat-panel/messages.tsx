"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import Image from "next/image";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Circle,
  Copy,
  EnvelopeSimple,
  File,
  GitDiff,
  Info,
  Question,
  Robot,
  SpinnerGap,
  TreeStructure,
  XCircle,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  parseEmailDraftOutput,
  type EmailDraftOutput,
} from "@/components/workspace/chat-panel/email-draft";
import type { SessionTabInfo } from "@/components/workspace/chat-panel/types";
import { workspaceMarkdownComponents } from "@/components/workspace/markdown-components";
import type { MessagePart } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import { getWorkspaceToolDisplay } from "@/lib/workspace-tool-display";
import type { ChatMessage } from "@/types/workspace";

type ToolPart = Extract<MessagePart, { type: "tool" }>;
type FilePart = Extract<MessagePart, { type: "file" }>;
type TodoItem = { id: string; title: string; status: "pending" | "in_progress" | "completed" };

type ChatPanelMessagesProps = {
  chatContentStyle: CSSProperties;
  connectorNamesById: Record<string, string>;
  isStartingNewSession: boolean;
  messages: ChatMessage[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (path: string) => void;
  onScrollContainer: () => void;
  onSelectSessionTab?: (id: string) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sessionTabs: SessionTabInfo[];
  workspaceRoot?: string;
};

type ToolDisplay = {
  summary?: string;
  label?: string;
  meta?: string;
  path?: string;
};

type PartGroup =
  | { type: "tool-group"; tool: string; parts: ToolPart[] }
  | { type: "file-group"; parts: FilePart[] }
  | { type: "single"; part: MessagePart };

const CHAT_ERROR_MESSAGES: Record<string, { title: string; description?: string }> = {
  cancelled: {
    title: "Response cancelled",
    description: "The message was stopped before it finished.",
  },
  forbidden: {
    title: "Permission denied",
    description: "You are not allowed to perform this action.",
  },
  instance_unavailable: {
    title: "Workspace unavailable",
    description: "The workspace is not ready right now. Try again in a moment.",
  },
  missing_fields: {
    title: "Message couldn't be sent",
    description: "The request was incomplete, so it never reached the model.",
  },
  rate_limited: {
    title: "Rate limited",
    description: "Too many requests were sent at once. Try again in a moment.",
  },
  resume_exhausted: {
    title: "Couldn't resume response",
    description: "We retried the interrupted response, but it still could not be recovered.",
  },
  resume_incomplete: {
    title: "Response interrupted",
    description: "The previous response could not be resumed completely.",
  },
  stream_incomplete: {
    title: "Response interrupted",
    description: "The model stopped before returning any visible content.",
  },
  too_many_attachments: {
    title: "Too many attachments",
    description: "Remove some files and try sending the message again.",
  },
  unauthorized: {
    title: "Session expired",
    description: "Sign in again and retry your message.",
  },
};

const TOOL_LABELS: Record<string, string> = {
  glob: "Searching documents",
  grep: "Searching information",
  list: "Listing files",
  read: "Reading file",
  write: "Writing file",
  edit: "Editing file",
  apply_patch: "Applying changes",
  webfetch: "Searching the web",
  bash: "Running command",
  task: "Delegating",
  email_draft: "Drafting email",
  todowrite: "Planning",
  todoread: "Reviewing plan",
};

const getString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const getNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item)) : undefined;

function formatToolName(tool: string): string {
  const formatted = tool.replace(/[_-]+/g, " ").trim();
  if (!formatted) return tool;
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function relativizePath(absolutePath: string | undefined, workspaceRoot: string | undefined): string | undefined {
  if (!absolutePath || !workspaceRoot) return absolutePath;
  const prefix = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length) || ".";
  }
  if (absolutePath === workspaceRoot) return ".";
  return absolutePath;
}

const getFileName = (path?: string) => (path ? path.split("/").pop() ?? path : undefined);
const getDirectory = (path?: string) => {
  if (!path || !path.includes("/")) return undefined;
  return path.split("/").slice(0, -1).join("/") || undefined;
};

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
}

function isSameMinute(ts1?: number, ts2?: number): boolean {
  if (!ts1 || !ts2) return false;
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate() &&
    d1.getHours() === d2.getHours() &&
    d1.getMinutes() === d2.getMinutes()
  );
}

function humanizeChatErrorCode(code: string): string {
  if (!/^[a-z0-9_]+$/.test(code)) return code;
  const phrase = code.replace(/_/g, " ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function getChatErrorCopy(detail?: string): { title: string; description?: string } {
  const source = detail?.trim();
  if (!source) {
    return {
      title: "Message failed",
      description: "Something went wrong before the assistant could answer.",
    };
  }

  const mapped = CHAT_ERROR_MESSAGES[source];
  if (mapped) return mapped;

  if (/^[a-z0-9_]+$/.test(source)) {
    return {
      title: "Message failed",
      description: humanizeChatErrorCode(source),
    };
  }

  return {
    title: "Message failed",
    description: source,
  };
}

function getToolLabel(tool: string, connectorNamesById?: Record<string, string>) {
  const toolDisplay = getWorkspaceToolDisplay(tool, connectorNamesById);
  if (toolDisplay.isConnectorTool) return toolDisplay.groupLabel;
  return TOOL_LABELS[tool] ?? formatToolName(tool);
}

function getToolDisplay(
  tool: string,
  input?: Record<string, unknown>,
  fallbackTitle?: string,
  connectorNamesById?: Record<string, string>,
  workspaceRoot?: string,
): ToolDisplay {
  const toolDisplay = getWorkspaceToolDisplay(tool, connectorNamesById);
  if (toolDisplay.isConnectorTool) {
    return {
      summary: toolDisplay.commandLabel,
      label: toolDisplay.commandLabel ?? fallbackTitle,
    };
  }

  const rawPath = typeof input?.path === "string" ? input.path : undefined;
  const normalizedPath = rawPath === "" ? "/" : rawPath;
  const rawFilePath = getString(input?.filePath) ?? getString(input?.filename);
  const filePath = relativizePath(rawFilePath, workspaceRoot);
  const searchPath = relativizePath(getString(normalizedPath), workspaceRoot);
  const pattern = getString(input?.pattern);
  const include = getString(input?.include);
  const url = getString(input?.url);
  const format = getString(input?.format);
  const offset = getNumber(input?.offset);
  const limit = getNumber(input?.limit);
  const description = getString(input?.description);
  const command = getString(input?.command);
  const files = getStringArray(input?.files);

  const offsetLimit: string[] = [];
  if (offset !== undefined) offsetLimit.push(`offset=${offset}`);
  if (limit !== undefined) offsetLimit.push(`limit=${limit}`);

  switch (tool) {
    case "glob": {
      const summaryParts: string[] = [];
      if (pattern) summaryParts.push(`pattern=${pattern}`);
      if (include) summaryParts.push(`include=${include}`);
      if (searchPath) summaryParts.push(`in ${searchPath}`);
      return {
        summary: summaryParts.join(" · ") || undefined,
        label: pattern ? `pattern=${pattern}` : searchPath ? `in ${searchPath}` : fallbackTitle,
        meta: searchPath && pattern ? `in ${searchPath}` : undefined,
      };
    }
    case "grep": {
      const summaryParts: string[] = [];
      if (pattern) summaryParts.push(`pattern=${pattern}`);
      if (include) summaryParts.push(`include=${include}`);
      if (searchPath) summaryParts.push(`in ${searchPath}`);
      return {
        summary: summaryParts.join(" · ") || undefined,
        label: pattern ? `pattern=${pattern}` : fallbackTitle,
        meta:
          [include ? `include=${include}` : undefined, searchPath ? `in ${searchPath}` : undefined]
            .filter(Boolean)
            .join(" · ") || undefined,
      };
    }
    case "list":
      return {
        summary: searchPath ? `in ${searchPath}` : undefined,
        label: searchPath ? `in ${searchPath}` : fallbackTitle,
      };
    case "read": {
      const resolvedPath = filePath ?? searchPath;
      return {
        summary: [resolvedPath, ...offsetLimit].filter(Boolean).join(" · ") || undefined,
        label: getFileName(resolvedPath) ?? resolvedPath ?? fallbackTitle,
        meta: [getDirectory(resolvedPath), ...offsetLimit].filter(Boolean).join(" · ") || undefined,
        path: resolvedPath,
      };
    }
    case "write":
    case "edit": {
      const resolvedPath = filePath ?? searchPath;
      return {
        summary: resolvedPath ?? fallbackTitle,
        label: getFileName(resolvedPath) ?? resolvedPath ?? fallbackTitle,
        meta: getDirectory(resolvedPath),
        path: resolvedPath,
      };
    }
    case "apply_patch": {
      const count = files?.length ?? 0;
      const singlePath = count === 1 ? relativizePath(files?.[0], workspaceRoot) : undefined;
      return {
        summary: count > 0 ? `${count} file${count === 1 ? "" : "s"}` : fallbackTitle,
        label: singlePath ? getFileName(singlePath) ?? singlePath : fallbackTitle,
        meta: singlePath ? getDirectory(singlePath) : undefined,
        path: singlePath,
      };
    }
    case "webfetch": {
      return {
        summary: [url, format ? `format=${format}` : undefined].filter(Boolean).join(" · ") || undefined,
        label: url ?? fallbackTitle,
        meta: format ? `format=${format}` : undefined,
      };
    }
    case "bash": {
      return {
        summary: description ?? command ?? fallbackTitle,
        label: description ?? command ?? fallbackTitle,
      };
    }
    case "task": {
      const subagentType = getString(input?.subagent_type);
      const taskDescription = getString(input?.description);
      const agentLabel = subagentType
        ? subagentType.charAt(0).toUpperCase() + subagentType.slice(1)
        : undefined;
      return {
        summary: taskDescription || agentLabel || fallbackTitle,
        label: agentLabel || fallbackTitle,
        meta: agentLabel && taskDescription ? taskDescription : undefined,
      };
    }
    default:
      return {
        summary: fallbackTitle,
        label: fallbackTitle,
      };
  }
}

function MessageFooter({ message, showTimestamp = true }: { message: ChatMessage; showTimestamp?: boolean }) {
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const tokenInfo = useMemo(() => {
    if (!message.parts || message.role === "user") return null;

    let totalInput = 0;
    let totalOutput = 0;

    for (const part of message.parts) {
      if (part.type === "step-finish") {
        totalInput += part.tokens.input;
        totalOutput += part.tokens.output;
      }
    }

    if (totalInput === 0 && totalOutput === 0) return null;

    return { input: totalInput, output: totalOutput, total: totalInput + totalOutput };
  }, [message.parts, message.role]);

  const handleCopy = useCallback(async () => {
    const textToCopy =
      message.parts && message.parts.length > 0
        ? message.parts
            .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : message.content;

    try {
      const copiedToClipboard = await copyTextToClipboard(textToCopy);
      if (!copiedToClipboard) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, [message.content, message.parts]);

  const handleInfoClick = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowTokenInfo(true);
  }, []);

  const handleInfoMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowTokenInfo(false);
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const isUser = message.role === "user";

  const actionButtons = (
    <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
        title="Copy message"
      >
        {copied ? (
          <CheckCircle size={12} weight="fill" className="text-primary" />
        ) : (
          <Copy size={12} />
        )}
      </button>

      {tokenInfo ? (
        <div className="relative" onMouseLeave={handleInfoMouseLeave}>
          <button
            type="button"
            onClick={handleInfoClick}
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          >
            <Info size={12} />
          </button>

          {showTokenInfo ? (
            <div
              className={cn(
                "absolute bottom-full mb-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md",
                isUser ? "right-0" : "left-0"
              )}
            >
              <div className="flex flex-col gap-0.5 whitespace-nowrap">
                <span className="font-medium">{tokenInfo.total.toLocaleString()} tokens</span>
                <span className="text-muted-foreground">
                  {tokenInfo.input.toLocaleString()} input · {tokenInfo.output.toLocaleString()} output
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const timestamp = !message.pending && showTimestamp ? (
    <span className={cn("chat-text-micro text-muted-foreground/60", isUser ? "px-1" : "")}>{message.timestamp}</span>
  ) : null;

  return (
    <div className="flex items-center gap-2">
      {isUser ? (
        <>
          {actionButtons}
          {timestamp}
        </>
      ) : (
        <>
          {timestamp}
          {actionButtons}
        </>
      )}
    </div>
  );
}

function AssistantErrorNotice({ detail }: { detail?: string }) {
  const copy = getChatErrorCopy(detail);

  return (
    <div className="my-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <XCircle size={16} weight="fill" className="shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="leading-none font-medium text-foreground">{copy.title}</p>
          {copy.description ? <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretDown size={10} className={cn("transition-transform", isOpen && "rotate-180")} />
        <span>Reasoning</span>
      </button>
      {isOpen ? (
        <div className="markdown-content ml-4 border-l border-border/40 pl-3 pt-1 text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

function parseTodoItems(parts: ToolPart[]): TodoItem[] {
  for (let i = parts.length - 1; i >= 0; i--) {
    const todos = parts[i].state.input?.todos;
    if (Array.isArray(todos)) {
      return todos
        .flatMap((item, index) => {
          if (typeof item !== "object" || item === null) return [];

          const record = item as Record<string, unknown>;
          const title = getString(record.title) ?? getString(record.content);
          if (!title) return [];

          const rawStatus = getString(record.status);

          return [{
            id: getString(record.id) ?? `todo-${index}-${title}`,
            title,
            status: (["pending", "in_progress", "completed"].includes(rawStatus ?? "")
              ? rawStatus
              : "pending") as TodoItem["status"],
          }];
        });
    }
  }
  return [];
}

function TodoCard({ parts }: { parts: ToolPart[] }) {
  const isRunning = parts.some(
    (p) => p.state.status === "running" || p.state.status === "pending"
  );
  const todos = parseTodoItems(parts);

  if (todos.length === 0) {
    return (
      <div className="my-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          {isRunning ? (
            <SpinnerGap size={12} className="animate-spin text-primary" />
          ) : (
            <CheckCircle size={12} weight="fill" className="text-primary" />
          )}
          <span className="font-medium">Planning</span>
        </div>
      </div>
    );
  }

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const inProgressCount = todos.filter((t) => t.status === "in_progress").length;

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        {isRunning ? (
          <SpinnerGap size={12} className="animate-spin text-primary" />
        ) : (
          <CheckCircle size={12} weight="fill" className="text-primary" />
        )}
        <span className="font-medium">Planning</span>
        <span className="text-muted-foreground">
          {completedCount}/{todos.length} done
          {inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ""}
        </span>
      </div>
      <div className="border-t border-border/50 px-3 py-2">
        <div className="space-y-1">
          {todos.map((todo) => (
            <div key={todo.id} className="flex items-start gap-2 text-xs">
              {todo.status === "completed" ? (
                <CheckCircle size={12} weight="fill" className="mt-0.5 text-primary" />
              ) : todo.status === "in_progress" ? (
                <SpinnerGap size={12} className="mt-0.5 animate-spin text-primary" />
              ) : (
                <Circle size={12} className="mt-0.5 text-muted-foreground/60" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1",
                  todo.status === "completed"
                    ? "text-muted-foreground line-through"
                    : "text-foreground/80"
                )}
              >
                {todo.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function parseTaskSessionIdFromOutput(output: string): string | undefined {
  return output.match(/^task_id:\s*(\S+)/m)?.[1];
}

function getToolStateMetadata(state: ToolPart["state"]): Record<string, unknown> | undefined {
  return state.metadata && typeof state.metadata === "object" && !Array.isArray(state.metadata)
    ? state.metadata
    : undefined;
}

function getDelegationSessionId(part: ToolPart): string | undefined {
  const metadata = getToolStateMetadata(part.state);
  const outputSessionId = part.state.status === "completed"
    ? parseTaskSessionIdFromOutput(part.state.output)
    : undefined;

  return (
    getString(metadata?.sessionId) ??
    getString(metadata?.sessionID) ??
    getString(part.state.input.task_id) ??
    outputSessionId
  );
}

function DelegationCard({
  parts,
  sessionTabs,
  onSelectSessionTab,
}: {
  parts: ToolPart[];
  sessionTabs: SessionTabInfo[];
  onSelectSessionTab?: (id: string) => void;
}) {
  const getStateError = (state: ToolPart["state"]): string | undefined => {
    return "error" in state && typeof state.error === "string" ? state.error : undefined;
  };

  return (
    <div className="my-2 space-y-2">
      {parts.map((part) => {
        const subagentType = getString(part.state.input?.subagent_type);
        const taskDescription = getString(part.state.input?.description);
        const agentLabel = subagentType
          ? subagentType.charAt(0).toUpperCase() + subagentType.slice(1)
          : null;

        const isRunning = part.state.status === "running" || part.state.status === "pending";
        const isError = part.state.status === "error";
        const delegationSessionId = getDelegationSessionId(part);
        const exactTab = delegationSessionId
          ? sessionTabs.find((tab) => tab.id === delegationSessionId) ?? null
          : null;

        const matchingTab =
          exactTab ??
          (delegationSessionId
            ? null
            : sessionTabs.find((tab) => {
                if (tab.depth === 0) return false;
                if (!agentLabel) return false;
                return tab.title.toLowerCase().includes(subagentType!.toLowerCase());
              }) ?? sessionTabs.find((tab) => tab.depth > 0) ?? null);

        const canNavigate = Boolean(matchingTab && onSelectSessionTab);

        return (
          <div key={part.id} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isRunning ? <SpinnerGap size={14} className="shrink-0 animate-spin text-primary" /> : null}
                {isError ? <XCircle size={14} weight="fill" className="shrink-0 text-destructive" /> : null}
                <TreeStructure size={14} weight="fill" className="shrink-0 text-primary" />
                <span className="text-xs font-medium text-foreground">
                  {agentLabel ? `Delegated to ${agentLabel}` : "Delegated task"}
                </span>
              </div>

              {canNavigate ? (
                <button
                  type="button"
                  onClick={() => onSelectSessionTab?.(matchingTab!.id)}
                  className="chat-text-micro inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/20"
                >
                  View
                  <CaretRight size={12} />
                </button>
              ) : null}
            </div>

            {taskDescription ? (
              <p className="mt-1 pl-[22px] text-xs text-muted-foreground">{taskDescription}</p>
            ) : null}

            {isError && getStateError(part.state) ? (
              <p className="mt-1 pl-[22px] text-xs text-destructive">{getStateError(part.state)}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EmailDraftCopyButton({
  text,
  label,
  size = 14,
}: {
  text: string;
  label: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      const ok = await copyTextToClipboard(text);
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [text],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={label}
      aria-label={label}
    >
      {copied ? (
        <CheckCircle size={size} weight="fill" className="text-primary" />
      ) : (
        <Copy size={size} />
      )}
    </button>
  );
}

function EmailDraftCard({
  draft,
  isRunning,
}: {
  draft: EmailDraftOutput;
  isRunning: boolean;
}) {
  const headerRows = [
    { label: "To", value: draft.to.join(", ") },
    { label: "Cc", value: draft.cc.join(", ") },
    { label: "Bcc", value: draft.bcc.join(", ") },
  ].filter((row) => row.value.length > 0);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/60 bg-card text-sm shadow-sm">
      {/* ── Title bar ── */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-2.5">
        <EnvelopeSimple size={16} weight="fill" className="shrink-0 text-primary" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">
          Email draft
        </span>
        {isRunning ? (
          <span className="chat-text-micro inline-flex items-center gap-1 text-muted-foreground">
            <SpinnerGap size={12} className="animate-spin" />
            Updating
          </span>
        ) : null}
        <div className="ml-auto">
          <EmailDraftCopyButton text={draft.copyText} label="Copy email draft" />
        </div>
      </div>

      {/* ── Header fields (To, Cc, Bcc, Subject) ── */}
      <div className="divide-y divide-border/30 border-b border-border/40 bg-muted/15 px-4 text-[13px]">
        {headerRows.map((row) => (
          <div key={row.label} className="flex gap-3 py-1.5">
            <span className="w-12 shrink-0 text-muted-foreground">{row.label}:</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{row.value}</span>
          </div>
        ))}
        <div className="group/subject flex items-start gap-3 py-1.5">
          <span className="w-12 shrink-0 pt-px text-muted-foreground">Subject:</span>
          <span className="min-w-0 flex-1 font-medium text-foreground">{draft.subject}</span>
          <span className="shrink-0 opacity-0 transition-opacity group-hover/subject:opacity-100">
            <EmailDraftCopyButton text={draft.subject} label="Copy subject" size={12} />
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="group/body relative px-5 py-4">
        <span className="absolute top-2 right-3 shrink-0 opacity-0 transition-opacity group-hover/body:opacity-100">
          <EmailDraftCopyButton text={draft.body} label="Copy body" size={12} />
        </span>
        <p className="whitespace-pre-wrap leading-relaxed text-[13px] text-foreground">
          {draft.body}
        </p>
      </div>
    </div>
  );
}

function ToolGroup({
  tool,
  parts,
  onOpenFile,
  connectorNamesById,
  sessionTabs,
  onSelectSessionTab,
  workspaceRoot,
}: {
  tool: string;
  parts: ToolPart[];
  onOpenFile?: (path: string) => void;
  connectorNamesById?: Record<string, string>;
  sessionTabs: SessionTabInfo[];
  onSelectSessionTab?: (id: string) => void;
  workspaceRoot?: string;
}) {
  const runningCount = parts.filter(
    (part) => part.state.status === "running" || part.state.status === "pending"
  ).length;
  const errorCount = parts.filter((part) => part.state.status === "error").length;
  const completedCount = parts.filter((part) => part.state.status === "completed").length;
  const totalCount = parts.length;

  const isRunning = runningCount > 0;
  const isError = errorCount > 0;
  const canExpand = totalCount > 1 || isError;

  const [isOpen, setIsOpen] = useState(() =>
    totalCount === 1 ? isRunning || isError : false
  );

  if (tool === "task") {
    return (
      <DelegationCard
        parts={parts}
        sessionTabs={sessionTabs}
        onSelectSessionTab={onSelectSessionTab}
      />
    );
  }

  if (tool === "email_draft") {
    let latestDraft: EmailDraftOutput | null = null;

    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (part.state.status !== "completed") continue;

      const parsedDraft = parseEmailDraftOutput(part.state.output);
      if (!parsedDraft) continue;

      latestDraft = parsedDraft;
      break;
    }

    if (latestDraft) {
      return <EmailDraftCard draft={latestDraft} isRunning={isRunning} />;
    }
  }

  if (tool === "todowrite") {
    return <TodoCard parts={parts} />;
  }

  const getStateTitle = (state: ToolPart["state"] | undefined): string | undefined => {
    if (!state) return undefined;
    return "title" in state && typeof state.title === "string" ? state.title : undefined;
  };

  const getStateError = (state: ToolPart["state"]): string | undefined => {
    return "error" in state && typeof state.error === "string" ? state.error : undefined;
  };

  const toolLabel = getToolLabel(tool, connectorNamesById);
  const lastPart = parts[parts.length - 1];
  const headerDisplay = getToolDisplay(
    tool,
    lastPart?.state.input,
    getStateTitle(lastPart?.state) || lastPart?.name || toolLabel,
    connectorNamesById,
    workspaceRoot,
  );
  const summary =
    totalCount > 1
      ? `${totalCount} ${totalCount === 1 ? "call" : "calls"}${
          headerDisplay.summary ? ` · ${headerDisplay.summary}` : ""
        }`
      : headerDisplay.summary || getStateTitle(lastPart?.state) || lastPart?.name || tool;
  const showSummary = totalCount > 1 || Boolean(summary && summary !== tool);

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => {
          if (!canExpand) return;
          setIsOpen((previous) => !previous);
        }}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left text-xs",
          canExpand ? "cursor-pointer" : "cursor-default"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isRunning ? <SpinnerGap size={12} className="animate-spin text-primary" /> : null}
            {!isRunning && isError ? (
              <XCircle size={12} weight="fill" className="text-destructive" />
            ) : null}
            {!isRunning && !isError ? (
              <CheckCircle size={12} weight="fill" className="text-primary" />
            ) : null}
            <span className="shrink-0 whitespace-nowrap font-medium">{toolLabel}</span>
          </div>
          {showSummary ? (
            <p className="mt-0.5 truncate pl-5 text-left text-muted-foreground">{summary}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {totalCount > 1 ? (
            <span className="chat-text-micro text-muted-foreground">
              {completedCount > 0 ? `${completedCount} done` : ""}
              {runningCount > 0 ? `${completedCount > 0 ? " · " : ""}${runningCount} running` : ""}
              {errorCount > 0
                ? `${completedCount > 0 || runningCount > 0 ? " · " : ""}${errorCount} error`
                : ""}
            </span>
          ) : null}

          {headerDisplay.path && onOpenFile && totalCount === 1 ? (
            <span
              role="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenFile(headerDisplay.path!);
              }}
              className="chat-text-micro inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Open
              <CaretRight size={12} />
            </span>
          ) : null}

          {canExpand ? (
            <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
          ) : null}
        </div>
      </button>

      {isOpen && canExpand ? (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="space-y-1">
            {parts.map((part) => {
              const itemRunning = part.state.status === "running" || part.state.status === "pending";
              const itemError = part.state.status === "error";
              const itemComplete = part.state.status === "completed";
              const detail = getToolDisplay(
                tool,
                part.state.input,
                getStateTitle(part.state) || part.name,
                connectorNamesById,
                workspaceRoot,
              );
              const title = detail.label || getStateTitle(part.state) || part.name;

              return (
                <div key={part.id} className="flex items-start gap-2 text-xs">
                  {itemRunning ? <SpinnerGap size={12} className="animate-spin text-primary" /> : null}
                  {itemError ? <XCircle size={12} weight="fill" className="text-destructive" /> : null}
                  {itemComplete ? <CheckCircle size={12} weight="fill" className="text-primary" /> : null}
                  {!itemRunning && !itemError && !itemComplete ? (
                    <Circle size={10} weight="fill" className="text-muted-foreground/60" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-foreground/80">{title}</span>
                      {detail.meta ? (
                        <span className="min-w-0 truncate text-muted-foreground">{detail.meta}</span>
                      ) : null}
                      {detail.path && onOpenFile ? (
                        <span
                          role="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenFile(detail.path!);
                          }}
                          className="chat-text-micro ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          Open
                          <CaretRight size={12} />
                        </span>
                      ) : null}
                    </div>

                    {itemError && getStateError(part.state) ? (
                      <div className="chat-text-note mt-0.5 text-destructive">{getStateError(part.state)}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileGroup({ parts, onOpenFile }: { parts: FilePart[]; onOpenFile: (path: string) => void }) {
  const totalCount = parts.length;
  const [isOpen, setIsOpen] = useState(() => totalCount <= 2);

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <File size={12} weight="bold" className="text-primary" />
        <span className="font-medium">Files</span>
        <span className="text-muted-foreground">
          {totalCount} {totalCount === 1 ? "file" : "files"}
        </span>
        <span className="chat-text-micro ml-auto text-muted-foreground">{isOpen ? "Hide" : "Show"}</span>
        <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen ? (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {parts.map((part) => (
              <button
                key={part.id ?? part.path}
                type="button"
                onClick={() => {
                  if (part.path) {
                    onOpenFile(part.path);
                  }
                }}
                className="flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-foreground/80 hover:bg-muted"
              >
                <File size={10} weight="bold" />
                <span>{part.filename || part.path}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupMessageParts(parts: MessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  let index = 0;

  while (index < parts.length) {
    const part = parts[index];

    if (part.type === "tool") {
      const toolName = part.name;
      const toolParts: ToolPart[] = [part];
      let cursor = index + 1;
      while (cursor < parts.length) {
        const next = parts[cursor];
        if (next.type !== "tool" || next.name !== toolName) break;
        toolParts.push(next);
        cursor += 1;
      }
      groups.push({ type: "tool-group", tool: toolName, parts: toolParts });
      index = cursor;
      continue;
    }

    if (part.type === "file") {
      const fileParts: FilePart[] = [part];
      let cursor = index + 1;
      while (cursor < parts.length) {
        const next = parts[cursor];
        if (next.type !== "file") break;
        fileParts.push(next);
        cursor += 1;
      }
      if (fileParts.length > 1) {
        groups.push({ type: "file-group", parts: fileParts });
      } else {
        groups.push({ type: "single", part });
      }
      index = cursor;
      continue;
    }

    groups.push({ type: "single", part });
    index += 1;
  }

  return groups;
}

function MessagePartRenderer({
  connectorNamesById,
  onOpenFile,
  onSelectSessionTab,
  part,
  sessionTabs,
  workspaceRoot,
}: {
  connectorNamesById: Record<string, string>;
  onOpenFile: (path: string) => void;
  onSelectSessionTab?: (id: string) => void;
  part: MessagePart;
  sessionTabs: SessionTabInfo[];
  workspaceRoot?: string;
}) {
  switch (part.type) {
    case "text":
      return (
        <div className="markdown-content my-3 first:mt-0 last:mb-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
            {part.text}
          </ReactMarkdown>
        </div>
      );

    case "reasoning":
      return <ReasoningBlock text={part.text} />;

    case "tool":
      return (
        <ToolGroup
          tool={part.name}
          parts={[part]}
          onOpenFile={onOpenFile}
          connectorNamesById={connectorNamesById}
          sessionTabs={sessionTabs}
          onSelectSessionTab={onSelectSessionTab}
          workspaceRoot={workspaceRoot}
        />
      );

    case "file":
      return (
        <button
          type="button"
          onClick={() => {
            if (part.path) {
              onOpenFile(part.path);
            }
          }}
          className="my-1 flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <File size={12} weight="bold" className="text-primary" />
          <span>{part.filename || part.path}</span>
        </button>
      );

    case "image":
      return (
        <div className="my-2">
          <Image
            src={part.url}
            alt="Attached image"
            width={1024}
            height={768}
            className="max-h-64 rounded-lg border border-border"
          />
        </div>
      );

    case "step-start":
      return null;

    case "step-finish":
      return null;

    case "patch":
      return (
        <div className="my-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs">
          <GitDiff size={14} className="text-primary" />
          <span>
            Changes in {part.files.length} file{part.files.length !== 1 ? "s" : ""}
          </span>
        </div>
      );

    case "agent":
      return (
        <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Robot size={12} className="text-primary" />
          <span>Agent: {part.name}</span>
        </div>
      );

    case "subtask":
      return (
        <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <TreeStructure size={12} weight="fill" />
            <span>Subtask -&gt; {part.agent}</span>
          </div>
          <p className="text-sm text-foreground/80">{part.description}</p>
        </div>
      );

    case "retry":
      return (
        <div className="my-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
          <ArrowClockwise size={14} />
          <span>Retrying (attempt {part.attempt})...</span>
        </div>
      );

    case "unknown":
      return (
        <div className="my-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Question size={12} />
            <span>Unknown type: {part.originalType}</span>
          </div>
          <pre className="overflow-x-auto text-xs text-muted-foreground">
            {JSON.stringify(part.data, null, 2)}
          </pre>
        </div>
      );

    default:
      return null;
  }
}

export function ChatPanelMessages({
  chatContentStyle,
  connectorNamesById,
  isStartingNewSession,
  messages,
  messagesEndRef,
  onOpenFile,
  onScrollContainer,
  onSelectSessionTab,
  scrollContainerRef,
  sessionTabs,
  workspaceRoot,
}: ChatPanelMessagesProps) {
  const showsCenteredState = isStartingNewSession || messages.length === 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        onScroll={onScrollContainer}
        className="workspace-chat-content h-full overflow-y-auto scrollbar-custom"
        style={chatContentStyle}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-[800px] flex-col px-5",
            showsCenteredState ? "h-full py-0" : "min-h-full py-6"
          )}
        >
          {isStartingNewSession ? (
            <div className="grid h-full place-items-center text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
                <p className="max-w-[260px] text-sm text-muted-foreground">Starting a new conversation...</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-card-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/50">
                <ChatCircle size={22} weight="regular" />
              </div>
              <p className="mt-4 max-w-[280px] text-sm font-medium text-foreground/80">
                Start a new conversation
              </p>
              <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-muted-foreground">
                Describe what you need and the agent will start working, or pick a previous session from the sidebar.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message, index) => {
                const nextMessage = messages[index + 1];
                const showTimestamp = !nextMessage || !isSameMinute(message.timestampRaw, nextMessage.timestampRaw);
                const assistantErrorDetail =
                  message.role === "assistant" && message.statusInfo?.status === "error"
                    ? message.statusInfo.detail
                    : undefined;

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "group/message flex flex-col gap-1.5",
                      message.role === "user" ? "items-end" : "items-start"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="w-full text-sm leading-relaxed text-foreground">
                        {message.parts && message.parts.length > 0 ? (
                          <div className="space-y-2">
                            {groupMessageParts(message.parts).map((group, groupIndex) => {
                              if (group.type === "tool-group") {
                                return (
                                  <ToolGroup
                                    key={`${message.id}-tool-${groupIndex}-${group.tool}`}
                                    tool={group.tool}
                                    parts={group.parts}
                                    onOpenFile={onOpenFile}
                                    connectorNamesById={connectorNamesById}
                                    sessionTabs={sessionTabs}
                                    onSelectSessionTab={onSelectSessionTab}
                                    workspaceRoot={workspaceRoot}
                                  />
                                );
                              }

                              if (group.type === "file-group") {
                                return (
                                  <FileGroup
                                    key={`${message.id}-file-${groupIndex}`}
                                    parts={group.parts}
                                    onOpenFile={onOpenFile}
                                  />
                                );
                              }

                              return (
                                <MessagePartRenderer
                                  key={`${message.id}-part-${groupIndex}`}
                                  connectorNamesById={connectorNamesById}
                                  part={group.part}
                                  onOpenFile={onOpenFile}
                                  sessionTabs={sessionTabs}
                                  onSelectSessionTab={onSelectSessionTab}
                                  workspaceRoot={workspaceRoot}
                                />
                              );
                            })}
                          </div>
                        ) : message.content ? (
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : null}

                        {assistantErrorDetail ? <AssistantErrorNotice detail={assistantErrorDetail} /> : null}

                        {message.attachments && message.attachments.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.attachments.map((attachment) => (
                              <button
                                key={`${message.id}-${attachment.label}`}
                                type="button"
                                onClick={() => {
                                  if (attachment.path) {
                                    onOpenFile(attachment.path);
                                  }
                                }}
                                className="flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-xs text-foreground/80 hover:bg-muted"
                              >
                                <File size={10} weight="bold" />
                                {attachment.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                          message.role === "user"
                            ? "bg-muted/60 text-foreground"
                            : "bg-muted/40 text-muted-foreground italic"
                        )}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        {message.attachments && message.attachments.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.attachments.map((attachment) => (
                              <button
                                key={`${message.id}-${attachment.label}`}
                                type="button"
                                onClick={() => {
                                  if (attachment.path) {
                                    onOpenFile(attachment.path);
                                  }
                                }}
                                className="flex items-center gap-1 rounded bg-background/60 px-2 py-0.5 text-xs text-foreground/80 hover:bg-background"
                              >
                                <File size={10} weight="bold" />
                                {attachment.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}

                    <MessageFooter message={message} showTimestamp={showTimestamp} />
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background via-background/90 to-transparent"
      />
    </div>
  );
}
