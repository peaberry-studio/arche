"use client";

import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Circle,
  Copy,
  DownloadSimple,
  DotsThree,
  File,
  FolderOpen,
  GitDiff,
  Info,
  MagnifyingGlass,
  Paperclip,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Question,
  Robot,
  SpinnerGap,
  TreeStructure,
  UploadSimple,
  X,
  XCircle
} from "@phosphor-icons/react";

import Image from "next/image";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { StatusIndicator } from "@/components/workspace/bitmap-status-indicator";
import { workspaceMarkdownComponents } from "@/components/workspace/markdown-components";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import type { AvailableModel, MessagePart } from "@/lib/opencode/types";
import {
  buildWorkspaceSessionMarkdown,
  getWorkspaceSessionExportFilename,
} from "@/lib/workspace-session-export";
import { getWorkspaceToolDisplay } from "@/lib/workspace-tool-display";
import { formatAttachmentSize } from "@/lib/workspace-attachments";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatSession,
  MessageAttachmentInput,
  WorkspaceAttachment
} from "@/types/workspace";

type ChatPanelProps = {
  slug: string;
  attachmentsEnabled?: boolean;
  sessions: ChatSession[];
  messages: ChatMessage[];
  activeSessionId: string | null;
  sessionTabs?: Array<{ id: string; title: string; depth: number; status?: string }>;
  openFilePaths: string[];
  onCloseSession: (id: string) => void;
  onRenameSession?: (id: string, title: string) => Promise<boolean>;
  onSelectSessionTab?: (id: string) => void;
  onOpenFile: (path: string) => void;
  onShowContext?: () => void;
  // New props for real functionality
  onSendMessage?: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: { attachments?: MessageAttachmentInput[]; contextPaths?: string[] }
  ) => Promise<boolean>;
  onAbortMessage?: () => Promise<void> | void;
  isSending?: boolean;
  isStartingNewSession?: boolean;
  models?: AvailableModel[];
  agentDefaultModel?: AvailableModel | null;
  selectedModel?: AvailableModel | null;
  hasManualModelSelection?: boolean;
  onSelectModel?: (model: AvailableModel | null) => void;
  activeAgentName?: string | null;
  isReadOnly?: boolean;
  onReturnToMainConversation?: () => void;
  pendingInsert?: string | null;
  onPendingInsertConsumed?: () => void;
};

type ContextMode = "auto" | "manual" | "off";

type ConnectorSummary = {
  id: string;
  name: string;
};

const MAX_CONTEXT_PATHS_PER_MESSAGE = 20;

/**
 * Check if two timestamps are in the same minute.
 */
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

/**
 * Renders the message footer with timestamp and action icons (copy, info).
 * @param showTimestamp - If false, the timestamp is hidden (used when grouping messages by minute)
 */
function MessageFooter({ message, showTimestamp = true }: { message: ChatMessage; showTimestamp?: boolean }) {
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate total tokens from step-finish parts
  const tokenInfo = useMemo(() => {
    if (!message.parts || message.role === 'user') return null;
    
    let totalInput = 0;
    let totalOutput = 0;
    
    for (const part of message.parts) {
      if (part.type === 'step-finish') {
        totalInput += part.tokens.input;
        totalOutput += part.tokens.output;
      }
    }
    
    if (totalInput === 0 && totalOutput === 0) return null;
    
    return { input: totalInput, output: totalOutput, total: totalInput + totalOutput };
  }, [message.parts, message.role]);

  const handleCopy = useCallback(async () => {
    const textToCopy = message.content || message.parts
      ?.filter(p => p.type === 'text' || p.type === 'reasoning')
      .map(p => (p as { text: string }).text)
      .join('\n') || '';
    
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback for older browsers or non-HTTPS contexts
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const isUser = message.role === "user";

  const actionButtons = (
    <div className="flex items-center gap-1 opacity-0 pointer-events-none transition-opacity group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
      {/* Copy button */}
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
      
      {/* Info button - only for assistant messages with token info */}
      {tokenInfo && (
        <div 
          className="relative"
          onMouseLeave={handleInfoMouseLeave}
        >
          <button
            type="button"
            onClick={handleInfoClick}
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          >
            <Info size={12} />
          </button>
          
          {/* Token info popover */}
          {showTokenInfo && (
            <div className={cn(
              "absolute bottom-full mb-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md",
              isUser ? "right-0" : "left-0"
            )}>
              <div className="flex flex-col gap-0.5 whitespace-nowrap">
                <span className="font-medium">{tokenInfo.total.toLocaleString()} tokens</span>
                <span className="text-muted-foreground">
                  {tokenInfo.input.toLocaleString()} input · {tokenInfo.output.toLocaleString()} output
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Only show timestamp when message is complete (not streaming) and showTimestamp is true
  const timestamp = !message.pending && showTimestamp ? (
    <span className={cn(
      "chat-text-micro text-muted-foreground/60",
      isUser ? "px-1" : ""
    )}>
      {message.timestamp}
    </span>
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

function downloadMarkdownFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function AssistantErrorNotice({ detail }: { detail?: string }) {
  const copy = getChatErrorCopy(detail);

  return (
    <div className="my-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <XCircle size={16} weight="fill" className="shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="leading-none font-medium text-foreground">{copy.title}</p>
          {copy.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ToolPart = Extract<MessagePart, { type: "tool" }>;
type FilePart = Extract<MessagePart, { type: "file" }>;

const getString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const getNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item)) : undefined;

const getFileName = (path?: string) => (path ? path.split("/").pop() ?? path : undefined);
const getDirectory = (path?: string) => {
  if (!path || !path.includes("/")) return undefined;
  return path.split("/").slice(0, -1).join("/") || undefined;
};

type ToolDisplay = {
  summary?: string;
  label?: string;
  meta?: string;
  path?: string;
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
  todowrite: "Planning",
  todoread: "Reviewing plan"
};

function getToolLabel(tool: string, connectorNamesById?: Record<string, string>) {
  const toolDisplay = getWorkspaceToolDisplay(tool, connectorNamesById);
  if (toolDisplay.isConnectorTool) return toolDisplay.groupLabel;
  return TOOL_LABELS[tool] ?? tool;
}

function getToolDisplay(
  tool: string,
  input?: Record<string, unknown>,
  fallbackTitle?: string,
  connectorNamesById?: Record<string, string>
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
  const filePath = getString(input?.filePath) ?? getString(input?.filename);
  const searchPath = getString(normalizedPath);
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
        meta: [include ? `include=${include}` : undefined, searchPath ? `in ${searchPath}` : undefined]
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
      const singlePath = count === 1 ? files?.[0] : undefined;
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

function ReasoningBlock({ text, isPending }: { text: string; isPending: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayedOpen = isPending ? true : isOpen;

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretDown size={10} className={cn("transition-transform", displayedOpen && "rotate-180")} />
        <span>Reasoning</span>
      </button>
      {displayedOpen && (
        <div className="ml-4 border-l border-border/40 pl-3 pt-1">
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

type SessionTabInfo = { id: string; title: string; depth: number; status?: string };

function DelegationCard({
  parts,
  sessionTabs,
  onSelectSessionTab,
}: {
  parts: ToolPart[];
  sessionTabs?: SessionTabInfo[];
  onSelectSessionTab?: (id: string) => void;
}) {
  const getStateError = (state: ToolPart['state']): string | undefined => {
    return 'error' in state && typeof state.error === 'string' ? state.error : undefined;
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

        // Try to find a matching child session tab for this delegation
        const matchingTab = sessionTabs?.find((tab) => {
          if (tab.depth === 0) return false;
          if (!agentLabel) return false;
          // Match by title containing the agent name (case-insensitive)
          return tab.title.toLowerCase().includes(subagentType!.toLowerCase());
        }) ?? (sessionTabs?.find((tab) => tab.depth > 0) ?? null);

        const canNavigate = !!matchingTab && !!onSelectSessionTab;

        return (
          <div key={part.id} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isRunning && <SpinnerGap size={14} className="shrink-0 animate-spin text-primary" />}
                {isError && <XCircle size={14} weight="fill" className="shrink-0 text-destructive" />}
                <TreeStructure size={14} weight="fill" className="shrink-0 text-primary" />
                <span className="text-xs font-medium text-foreground">
                  {agentLabel ? `Delegated to ${agentLabel}` : "Delegated task"}
                </span>
              </div>
              {canNavigate && (
                <button
                  type="button"
                  onClick={() => onSelectSessionTab!(matchingTab!.id)}
                  className="chat-text-micro inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/20"
                >
                  View
                  <CaretRight size={12} />
                </button>
              )}
            </div>
            {taskDescription && (
              <p className="mt-1 pl-[22px] text-xs text-muted-foreground">
                {taskDescription}
              </p>
            )}
            {isError && getStateError(part.state) && (
              <p className="mt-1 pl-[22px] text-xs text-destructive">
                {getStateError(part.state)}
              </p>
            )}
          </div>
        );
      })}
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
}: {
  tool: string;
  parts: ToolPart[];
  onOpenFile?: (path: string) => void;
  connectorNamesById?: Record<string, string>;
  sessionTabs?: SessionTabInfo[];
  onSelectSessionTab?: (id: string) => void;
}) {
  const runningCount = parts.filter(p => p.state.status === "running" || p.state.status === "pending").length;
  const errorCount = parts.filter(p => p.state.status === "error").length;
  const completedCount = parts.filter(p => p.state.status === "completed").length;
  const totalCount = parts.length;

  const isRunning = runningCount > 0;
  const isError = errorCount > 0;
  const canExpand = totalCount > 1 || isError;

  const [isOpen, setIsOpen] = useState(() => (totalCount === 1 ? isRunning || isError : false));

  // Delegate to the dedicated card for task tool calls
  if (tool === "task") {
    return (
      <DelegationCard
        parts={parts}
        sessionTabs={sessionTabs}
        onSelectSessionTab={onSelectSessionTab}
      />
    );
  }

  const getStateTitle = (state: ToolPart['state'] | undefined): string | undefined => {
    if (!state) return undefined;
    return 'title' in state && typeof state.title === 'string' ? state.title : undefined;
  };

  const getStateError = (state: ToolPart['state']): string | undefined => {
    return 'error' in state && typeof state.error === 'string' ? state.error : undefined;
  };

  const toolLabel = getToolLabel(tool, connectorNamesById);
  const lastPart = parts[parts.length - 1];
  const headerDisplay = getToolDisplay(
    tool,
    lastPart?.state.input,
    getStateTitle(lastPart?.state) || lastPart?.name || toolLabel,
    connectorNamesById
  );
  const summary = totalCount > 1
    ? `${totalCount} ${totalCount === 1 ? "call" : "calls"}${headerDisplay.summary ? ` · ${headerDisplay.summary}` : ""}`
    : headerDisplay.summary || getStateTitle(lastPart?.state) || lastPart?.name || tool;
  const showSummary = totalCount > 1 || (!!summary && summary !== tool);

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => {
          if (!canExpand) return;
          setIsOpen(prev => !prev);
        }}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left text-xs",
          canExpand ? "cursor-pointer" : "cursor-default"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isRunning && <SpinnerGap size={12} className="animate-spin text-primary" />}
            {!isRunning && isError && <XCircle size={12} weight="fill" className="text-destructive" />}
            {!isRunning && !isError && <CheckCircle size={12} weight="fill" className="text-primary" />}
            <span className="shrink-0 whitespace-nowrap font-medium">{toolLabel}</span>
          </div>
          {showSummary && (
            <p className="mt-0.5 truncate pl-5 text-left text-muted-foreground">{summary}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {totalCount > 1 && (
            <span className="chat-text-micro text-muted-foreground">
              {completedCount > 0 ? `${completedCount} done` : ""}
              {runningCount > 0 ? `${completedCount > 0 ? " · " : ""}${runningCount} running` : ""}
              {errorCount > 0 ? `${completedCount > 0 || runningCount > 0 ? " · " : ""}${errorCount} error` : ""}
            </span>
          )}
          {headerDisplay.path && onOpenFile && totalCount === 1 && (
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
          )}
          {canExpand && (
            <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
          )}
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="space-y-1">
            {parts.map(part => {
              const itemRunning = part.state.status === "running" || part.state.status === "pending";
              const itemError = part.state.status === "error";
              const itemComplete = part.state.status === "completed";
              const detail = getToolDisplay(
                tool,
                part.state.input,
                getStateTitle(part.state) || part.name,
                connectorNamesById
              );
              const title = detail.label || getStateTitle(part.state) || part.name;
              
              return (
                <div key={part.id} className="flex items-start gap-2 text-xs">
                  {itemRunning && <SpinnerGap size={12} className="animate-spin text-primary" />}
                  {itemError && <XCircle size={12} weight="fill" className="text-destructive" />}
                  {itemComplete && <CheckCircle size={12} weight="fill" className="text-primary" />}
                  {!itemRunning && !itemError && !itemComplete && <Circle size={10} weight="fill" className="text-muted-foreground/60" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-foreground/80">{title}</span>
                      {detail.meta && (
                        <span className="min-w-0 truncate text-muted-foreground">
                          {detail.meta}
                        </span>
                      )}
                      {detail.path && onOpenFile && (
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
                      )}
                    </div>
                    {itemError && getStateError(part.state) && (
                      <div className="chat-text-note mt-0.5 text-destructive">{getStateError(part.state)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
        onClick={() => setIsOpen(prev => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <File size={12} weight="bold" className="text-primary" />
        <span className="font-medium">Files</span>
        <span className="text-muted-foreground">{totalCount} {totalCount === 1 ? "file" : "files"}</span>
        <span className="chat-text-micro ml-auto text-muted-foreground">
          {isOpen ? "Hide" : "Show"}
        </span>
        <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {parts.map(part => (
              <button
                key={part.id ?? part.path}
                type="button"
                onClick={() => part.path && onOpenFile(part.path)}
                className="flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-foreground/80 hover:bg-muted"
              >
                <File size={10} weight="bold" />
                <span>{part.filename || part.path}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type PartGroup =
  | { type: "tool-group"; tool: string; parts: ToolPart[] }
  | { type: "file-group"; parts: FilePart[] }
  | { type: "single"; part: MessagePart };

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

/**
 * Renders a single message part based on its type.
 */
function MessagePartRenderer({ 
  part, 
  onOpenFile,
  isPending,
  sessionTabs,
  onSelectSessionTab,
}: { 
  part: MessagePart; 
  onOpenFile: (path: string) => void;
  isPending: boolean;
  sessionTabs?: SessionTabInfo[];
  onSelectSessionTab?: (id: string) => void;
}) {
  switch (part.type) {
    case 'text':
      return (
        <div className="markdown-content my-3 first:mt-0 last:mb-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
            {part.text}
          </ReactMarkdown>
        </div>
      );
    
    case 'reasoning':
      return <ReasoningBlock text={part.text} isPending={isPending} />;
    
    case 'tool': {
      return (
        <ToolGroup
          tool={part.name}
          parts={[part]}
          onOpenFile={onOpenFile}
          sessionTabs={sessionTabs}
          onSelectSessionTab={onSelectSessionTab}
        />
      );
    }
    
    case 'file':
      return (
        <button
          type="button"
          onClick={() => part.path && onOpenFile(part.path)}
          className="my-1 flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <File size={12} weight="bold" className="text-primary" />
          <span>{part.filename || part.path}</span>
        </button>
      );
    
    case 'image':
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
    
    case 'step-start':
      // Do not render - no visual value
      return null;
    
    case 'step-finish':
      // Do not render - tokens are shown in the timestamp tooltip
      return null;
    
    case 'patch':
      return (
        <div className="my-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs">
          <GitDiff size={14} className="text-primary" />
          <span>Changes in {part.files.length} file{part.files.length !== 1 ? 's' : ''}</span>
        </div>
      );
    
    case 'agent':
      return (
        <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Robot size={12} className="text-primary" />
          <span>Agent: {part.name}</span>
        </div>
      );
    
    case 'subtask':
      return (
        <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <TreeStructure size={12} weight="fill" />
            <span>Subtask -&gt; {part.agent}</span>
          </div>
          <p className="text-sm text-foreground/80">
            {part.description}
          </p>
        </div>
      );
    
    case 'retry':
      return (
        <div className="my-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
          <ArrowClockwise size={14} />
          <span>Retrying (attempt {part.attempt})...</span>
        </div>
      );
    
    case 'unknown':
      // Fallback: render raw data for debugging
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

export function ChatPanel({
  slug,
  attachmentsEnabled = true,
  sessions,
  messages,
  activeSessionId,
  sessionTabs = [],
  openFilePaths,
  onCloseSession,
  onRenameSession,
  onSelectSessionTab,
  onOpenFile,
  onShowContext,
  onSendMessage,
  onAbortMessage,
  isSending = false,
  isStartingNewSession = false,
  models = [],
  agentDefaultModel,
  selectedModel,
  hasManualModelSelection = false,
  onSelectModel,
  isReadOnly = false,
  onReturnToMainConversation,
  pendingInsert,
  onPendingInsertConsumed
}: ChatPanelProps) {
  const { chatFontFamily, chatFontSize } = useWorkspaceTheme();
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isStuckToBottomRef = useRef(true);
  const chatContentStyle = useMemo(
    () => ({
      '--workspace-chat-font-family': chatFontFamily === 'serif'
        ? 'var(--font-chat-serif), Georgia, serif'
        : 'var(--font-geist-sans), system-ui, sans-serif',
      '--workspace-chat-font-size': `${chatFontSize}px`,
      '--workspace-chat-font-size-xs': `${Math.max(chatFontSize - 2, 12)}px`,
      '--workspace-chat-font-size-note': `${Math.max(chatFontSize - 3, 11)}px`,
      '--workspace-chat-font-size-micro': `${Math.max(chatFontSize - 4, 10)}px`,
      '--workspace-chat-line-height': '1.65',
    }) as CSSProperties,
    [chatFontFamily, chatFontSize]
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const preventSessionMenuAutoFocusRef = useRef(false);
  const ignoreNextTitleBlurRef = useRef(false);
  const [inputValue, setInputValue] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isManageAttachmentsOpen, setIsManageAttachmentsOpen] = useState(false);
  const [attachmentSearch, setAttachmentSearch] = useState("");
  const [selectedAttachmentPaths, setSelectedAttachmentPaths] = useState<string[]>([]);
  const [isMutatingAttachments, setIsMutatingAttachments] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>("auto");
  const [manualContextPaths, setManualContextPaths] = useState<string[]>([]);
  const [connectorNamesById, setConnectorNamesById] = useState<Record<string, string>>({});
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const selectedAttachments = useMemo(
    () => {
      if (!attachmentsEnabled) return [];

      return selectedAttachmentPaths
        .map((path) => attachments.find((attachment) => attachment.path === path))
        .filter((attachment): attachment is WorkspaceAttachment => Boolean(attachment));
    },
    [attachments, attachmentsEnabled, selectedAttachmentPaths]
  );

  const contextModeStorageKey = useMemo(
    () => `arche.workspace.${slug}.context-mode`,
    [slug]
  );

  const normalizedOpenFilePaths = useMemo(() => {
    const uniquePaths = new Set<string>();
    const normalized: string[] = [];
    for (const path of openFilePaths) {
      const trimmedPath = path.trim();
      if (!trimmedPath || uniquePaths.has(trimmedPath)) continue;
      uniquePaths.add(trimmedPath);
      normalized.push(trimmedPath);
    }
    return normalized;
  }, [openFilePaths]);

  const openFilePathSet = useMemo(
    () => new Set(normalizedOpenFilePaths),
    [normalizedOpenFilePaths]
  );

  const isEditingActiveSessionTitle = Boolean(
    activeSession && editingSessionId === activeSession.id
  );

  const cancelSessionRename = useCallback(() => {
    if (isSavingTitle) return;

    setEditingSessionId(null);
    setDraftTitle("");
    setRenameError(null);
  }, [isSavingTitle]);

  const startSessionRename = useCallback(() => {
    if (!activeSession || !onRenameSession) return;

    preventSessionMenuAutoFocusRef.current = true;
    setEditingSessionId(activeSession.id);
    setDraftTitle(activeSession.title);
    setRenameError(null);
  }, [activeSession, onRenameSession]);

  const submitSessionRename = useCallback(async (rawTitle?: string) => {
    if (!activeSession || !onRenameSession || isSavingTitle) return;
    if (editingSessionId !== activeSession.id) return;

    const nextTitle = (rawTitle ?? titleInputRef.current?.value ?? draftTitle).trim();
    if (!nextTitle || nextTitle === activeSession.title) {
      cancelSessionRename();
      return;
    }

    setIsSavingTitle(true);
    setRenameError(null);

    const renamed = await onRenameSession(activeSession.id, nextTitle);

    setIsSavingTitle(false);

    if (!renamed) {
      setRenameError("rename_failed");
      return;
    }

    setEditingSessionId(null);
    setDraftTitle("");
    setRenameError(null);
  }, [
    activeSession,
    cancelSessionRename,
    draftTitle,
    editingSessionId,
    isSavingTitle,
    onRenameSession,
  ]);

  const handleTitleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ignoreNextTitleBlurRef.current = true;
        requestAnimationFrame(() => {
          ignoreNextTitleBlurRef.current = false;
        });
        void submitSessionRename(event.currentTarget.value);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelSessionRename();
      }
    },
    [cancelSessionRename, submitSessionRename]
  );

  const handleExportSessionMarkdown = useCallback(() => {
    if (!activeSession || typeof document === "undefined") return;

    const markdown = buildWorkspaceSessionMarkdown(activeSession.title, messages);
    const filename = getWorkspaceSessionExportFilename(activeSession.title);
    downloadMarkdownFile(filename, markdown);
  }, [activeSession, messages]);

  useEffect(() => {
    setEditingSessionId(null);
    setDraftTitle("");
    setIsSavingTitle(false);
    setRenameError(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!isEditingActiveSessionTitle) return;

    const frameId = requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frameId);
  }, [isEditingActiveSessionTitle]);

  const effectiveContextPaths = useMemo(() => {
    if (contextMode === "off") return [];
    if (contextMode === "manual") {
      return manualContextPaths.filter((path) => openFilePathSet.has(path));
    }
    return normalizedOpenFilePaths;
  }, [contextMode, manualContextPaths, normalizedOpenFilePaths, openFilePathSet]);

  const contextPathsToSend = useMemo(
    () => effectiveContextPaths.slice(0, MAX_CONTEXT_PATHS_PER_MESSAGE),
    [effectiveContextPaths]
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(contextModeStorageKey);
      if (stored === "auto" || stored === "manual" || stored === "off") {
        setContextMode(stored);
      }
    } catch {
      // Ignore storage access errors
    }
  }, [contextModeStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(contextModeStorageKey, contextMode);
    } catch {
      // Ignore storage access errors
    }
  }, [contextMode, contextModeStorageKey]);

  useEffect(() => {
    let cancelled = false;

    const loadConnectors = async () => {
      const response = await fetch(`/api/u/${slug}/connectors`, { cache: "no-store" });
      if (!response.ok || cancelled) return;

      const data = (await response.json().catch(() => null)) as
        | { connectors?: ConnectorSummary[] }
        | null;

      if (cancelled) return;

      const nextConnectors = Array.isArray(data?.connectors) ? data.connectors : [];
      setConnectorNamesById(
        nextConnectors.reduce<Record<string, string>>((accumulator, connector) => {
          const name = connector.name.trim();
          if (name) {
            accumulator[connector.id] = name;
          }
          return accumulator;
        }, {})
      );
    };

    void loadConnectors().catch(() => {
      if (!cancelled) {
        setConnectorNamesById({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setManualContextPaths((previous) =>
      previous.filter((path) => openFilePathSet.has(path))
    );
  }, [openFilePathSet]);

  const handleContextModeChange = useCallback(
    (nextMode: ContextMode) => {
      setContextMode(nextMode);
      if (nextMode !== "manual") return;

      setManualContextPaths((previous) => {
        const filtered = previous.filter((path) => openFilePathSet.has(path));
        if (filtered.length > 0) return filtered;
        return normalizedOpenFilePaths;
      });
    },
    [normalizedOpenFilePaths, openFilePathSet]
  );

  const toggleManualContextPath = useCallback((path: string) => {
    setManualContextPaths((previous) => {
      if (previous.includes(path)) {
        return previous.filter((entry) => entry !== path);
      }
      return [...previous, path];
    });
  }, []);

  const refreshAttachments = useCallback(async () => {
    if (!attachmentsEnabled) {
      setAttachments([]);
      setSelectedAttachmentPaths([]);
      setAttachmentsError(null);
      setIsLoadingAttachments(false);
      return;
    }

    setIsLoadingAttachments(true);
    try {
      const response = await fetch(`/api/w/${slug}/attachments`, {
        cache: "no-store",
      });
      const data = (await response
        .json()
        .catch(() => null)) as { attachments?: WorkspaceAttachment[]; error?: string } | null;

      if (!response.ok || !data?.attachments) {
        setAttachmentsError(data?.error ?? "attachments_load_failed");
        return;
      }

      const nextAttachments = data.attachments;
      setAttachments(nextAttachments);
      setSelectedAttachmentPaths((previous) =>
        previous.filter((path) =>
          nextAttachments.some((attachment) => attachment.path === path)
        )
      );
      setAttachmentsError(null);
    } catch {
      setAttachmentsError("attachments_load_failed");
    } finally {
      setIsLoadingAttachments(false);
    }
  }, [attachmentsEnabled, slug]);

  useEffect(() => {
    void refreshAttachments();
  }, [refreshAttachments]);

  const toggleAttachmentSelection = useCallback((path: string) => {
    setSelectedAttachmentPaths((previous) => {
      if (previous.includes(path)) {
        return previous.filter((entry) => entry !== path);
      }
      return [...previous, path];
    });
  }, []);

  const handleUploadAttachments = useCallback(async (files: File[]) => {
    if (!attachmentsEnabled || files.length === 0) return;

    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });

    setIsUploadingAttachment(true);
    setAttachmentsError(null);

    try {
      const response = await fetch(`/api/w/${slug}/attachments`, {
        method: "POST",
        body: formData,
      });

      const data = (await response
        .json()
        .catch(() => null)) as {
        uploaded?: WorkspaceAttachment[];
        failed?: Array<{ name: string; error: string }>;
        error?: string;
      } | null;

      if (!response.ok || !data?.uploaded) {
        setAttachmentsError(data?.error ?? "upload_failed");
        return;
      }

      const uploaded = data.uploaded;
      setAttachments((previous) => {
        const indexed = new Map(previous.map((attachment) => [attachment.path, attachment]));
        uploaded.forEach((attachment) => indexed.set(attachment.path, attachment));
        return [...indexed.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
      });
      setSelectedAttachmentPaths((previous) => {
        const selected = new Set(previous);
        uploaded.forEach((attachment) => selected.add(attachment.path));
        return [...selected];
      });
      if ((data.failed?.length ?? 0) > 0) {
        setAttachmentsError("upload_partial_failure");
      } else {
        setAttachmentsError(null);
      }
    } catch {
      setAttachmentsError("upload_failed");
    } finally {
      await refreshAttachments();
      setIsUploadingAttachment(false);
    }
  }, [attachmentsEnabled, refreshAttachments, slug]);

  const handleAttachmentInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      await handleUploadAttachments(Array.from(event.target.files ?? []));
      event.target.value = "";
    },
    [handleUploadAttachments]
  );

  const handleTextareaPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (
        !attachmentsEnabled ||
        isReadOnly ||
        isSending ||
        isStartingNewSession ||
        isUploadingAttachment ||
        !onSendMessage
      ) {
        return;
      }

      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const imageFilesFromItems = Array.from(clipboardData.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null && file.size > 0);

      const imageFiles =
        imageFilesFromItems.length > 0
          ? imageFilesFromItems
          : Array.from(clipboardData.files ?? []).filter(
              (file): file is File => file.type.startsWith("image/") && file.size > 0
            );

      if (imageFiles.length === 0) {
        return;
      }

      await handleUploadAttachments(imageFiles);
    },
    [
      handleUploadAttachments,
      attachmentsEnabled,
      isReadOnly,
      isSending,
      isStartingNewSession,
      isUploadingAttachment,
      onSendMessage,
    ]
  );

  const handleRenameAttachment = useCallback(
    async (attachment: WorkspaceAttachment) => {
      const nextName = window.prompt("Rename attachment", attachment.name);
      if (nextName == null) return;

      const trimmedName = nextName.trim();
      if (!trimmedName || trimmedName === attachment.name) return;

      setIsMutatingAttachments(true);
      setAttachmentsError(null);

      try {
        const response = await fetch(`/api/w/${slug}/attachments`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: attachment.path, name: trimmedName }),
        });
        const data = (await response
          .json()
          .catch(() => null)) as { attachment?: WorkspaceAttachment; error?: string } | null;

        if (!response.ok || !data?.attachment) {
          setAttachmentsError(data?.error ?? "rename_failed");
          return;
        }

        const updatedAttachment = data.attachment;

        setAttachments((previous) => {
          const indexed = new Map(previous.map((item) => [item.path, item]));
          indexed.delete(attachment.path);
          indexed.set(updatedAttachment.path, updatedAttachment);
          return [...indexed.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
        });
        setSelectedAttachmentPaths((previous) =>
          previous.map((path) =>
            path === attachment.path ? updatedAttachment.path : path
          )
        );
        setAttachmentsError(null);
      } catch {
        setAttachmentsError("rename_failed");
      } finally {
        setIsMutatingAttachments(false);
      }
    },
    [slug]
  );

  const handleDeleteAttachment = useCallback(
    async (attachment: WorkspaceAttachment) => {
      const confirmed = window.confirm(
        `Delete attachment "${attachment.name}"? This cannot be undone.`
      );
      if (!confirmed) return;

      setIsMutatingAttachments(true);
      setAttachmentsError(null);

      try {
        const response = await fetch(`/api/w/${slug}/attachments`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: attachment.path }),
        });
        const data = (await response
          .json()
          .catch(() => null)) as { ok?: boolean; error?: string } | null;

        if (!response.ok || !data?.ok) {
          setAttachmentsError(data?.error ?? "delete_failed");
          return;
        }

        setAttachments((previous) =>
          previous.filter((item) => item.path !== attachment.path)
        );
        setSelectedAttachmentPaths((previous) =>
          previous.filter((path) => path !== attachment.path)
        );
        setAttachmentsError(null);
      } catch {
        setAttachmentsError("delete_failed");
      } finally {
        setIsMutatingAttachments(false);
      }
    },
    [slug]
  );

  const recentAttachments = useMemo(
    () => attachments.slice(0, 5),
    [attachments]
  );

  const filteredAttachments = useMemo(() => {
    const query = attachmentSearch.trim().toLowerCase();
    if (!query) return attachments;
    return attachments.filter((attachment) =>
      attachment.name.toLowerCase().includes(query)
    );
  }, [attachmentSearch, attachments]);

  // Handle agent mention insertion from left panel
  useEffect(() => {
    if (!pendingInsert) return;
    const frameId = requestAnimationFrame(() => {
      setInputValue((prev) => prev + pendingInsert);
      textareaRef.current?.focus();
      onPendingInsertConsumed?.();
    });
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [pendingInsert, onPendingInsertConsumed]);

  // --- Smart auto-scroll: only scroll when the user is "stuck" to the bottom ---
  const SCROLL_BOTTOM_THRESHOLD = 60;

  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isStuckToBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    const isInitialLoad = prevMessagesLengthRef.current === 0 && messages.length > 0;
    prevMessagesLengthRef.current = messages.length;

    if (isInitialLoad) {
      // Always scroll on initial load
      isStuckToBottomRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      return;
    }

    if (!isStuckToBottomRef.current) return;

    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Restore focus when isSending changes from true to false
  const prevIsSendingRef = useRef(isSending);
  useEffect(() => {
    if (prevIsSendingRef.current && !isSending) {
      textareaRef.current?.focus();
    }
    prevIsSendingRef.current = isSending;
  }, [isSending]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    const hasSelectedAttachments = selectedAttachments.length > 0;
    if (
      (!text && !hasSelectedAttachments) ||
      isReadOnly ||
      !onSendMessage ||
      isSending ||
      isStartingNewSession ||
      isUploadingAttachment
    ) return;
    
    const model =
      hasManualModelSelection && selectedModel
        ? { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
        : undefined;

    const messageAttachments: MessageAttachmentInput[] = selectedAttachments.map(
      (attachment) => ({
        path: attachment.path,
        filename: attachment.name,
        mime: attachment.mime,
      })
    );
    const messageContextPaths = [...contextPathsToSend];

    // Re-engage auto-scroll so we follow the agent's response
    isStuckToBottomRef.current = true;

    const accepted = await onSendMessage(text, model, {
      attachments: messageAttachments,
      contextPaths: messageContextPaths,
    });

    if (!accepted) {
      textareaRef.current?.focus();
      return;
    }

    setInputValue("");
    textareaRef.current?.focus();
    setSelectedAttachmentPaths([]);
  }, [
    contextPathsToSend,
    inputValue,
    isReadOnly,
    onSendMessage,
    isSending,
    isStartingNewSession,
    hasManualModelSelection,
    selectedModel,
    selectedAttachments,
    isUploadingAttachment,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!inputValue) {
      textarea.style.height = "auto";
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [inputValue]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  }, []);

  // Get the current status from the last pending message (if any).
  // Only show transient statuses (thinking, tool calls) while actively streaming.
  // Error statuses from stale pending messages are hidden when no stream is active.
  const currentStatus = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.pending || !lastMessage?.statusInfo) return null;
    if (lastMessage.statusInfo.status === "complete" || lastMessage.statusInfo.status === "idle") return null;
    if (lastMessage.statusInfo.status === "error" && !isSending) return null;
    return lastMessage.statusInfo;
  }, [messages, isSending]);

  const titleInputClassName = cn(
    "h-8 min-w-[180px] rounded-md border bg-background/80 px-2.5 text-sm font-medium text-foreground outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0",
    renameError
      ? "border-destructive/40 focus-visible:ring-destructive/20"
      : "border-primary/20 focus-visible:ring-primary/20"
  );

  return (
    <div className="desktop-select-enabled flex h-full flex-col text-card-foreground">
      {/* Session header — shows tabs when multiple sessions exist, otherwise plain title */}
      <div className="mx-3 mt-2 flex min-h-11 shrink-0 items-center gap-2 border-b border-border/35 px-2 py-1">
        {sessionTabs.length > 1 ? (
          <div className="min-w-0 flex-1 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1">
              {sessionTabs.map((sessionTab) => {
                const isSubtask = sessionTab.depth > 0;
                const isActive = sessionTab.id === activeSessionId;
                const isEditing = isActive && editingSessionId === sessionTab.id;
                const isBusy = sessionTab.status === "busy";
                const isError = sessionTab.status === "error";

                if (isEditing) {
                  return (
                    <div
                      key={sessionTab.id}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1",
                        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
                      )}
                    >
                      {isSubtask ? (
                        <TreeStructure size={12} weight="fill" className="shrink-0" />
                      ) : (
                        <ChatCircle size={12} weight="fill" className="shrink-0" />
                      )}
                      {isBusy ? (
                        <SpinnerGap size={11} className="shrink-0 animate-spin text-primary" />
                      ) : isError ? (
                        <XCircle size={11} weight="fill" className="shrink-0 text-destructive" />
                      ) : null}
                      <input
                        ref={titleInputRef}
                        value={draftTitle}
                        onBlur={(event) => {
                          if (ignoreNextTitleBlurRef.current) {
                            ignoreNextTitleBlurRef.current = false;
                            return;
                          }

                          void submitSessionRename(event.currentTarget.value);
                        }}
                        onChange={(event) => {
                          setDraftTitle(event.target.value);
                          if (renameError) {
                            setRenameError(null);
                          }
                        }}
                        onKeyDown={handleTitleInputKeyDown}
                        className={cn(titleInputClassName, "w-[min(240px,45vw)] text-xs")}
                        aria-label="Session title"
                        disabled={isSavingTitle}
                      />
                    </div>
                  );
                }

                return (
                  <button
                    key={sessionTab.id}
                    type="button"
                    onClick={() => onSelectSessionTab?.(sessionTab.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    )}
                  >
                    {isSubtask ? (
                      <TreeStructure size={12} weight={isActive ? "fill" : "bold"} className="shrink-0" />
                    ) : (
                      <ChatCircle size={12} weight={isActive ? "fill" : "bold"} className="shrink-0" />
                    )}
                    {isBusy ? (
                      <SpinnerGap size={11} className="shrink-0 animate-spin text-primary" />
                    ) : isError ? (
                      <XCircle size={11} weight="fill" className="shrink-0 text-destructive" />
                    ) : null}
                    <span className={cn(isActive ? "whitespace-nowrap" : "max-w-[180px] truncate")}>
                      {sessionTab.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 px-2">
            {isEditingActiveSessionTitle ? (
              <input
                ref={titleInputRef}
                value={draftTitle}
                onBlur={(event) => {
                  if (ignoreNextTitleBlurRef.current) {
                    ignoreNextTitleBlurRef.current = false;
                    return;
                  }

                  void submitSessionRename(event.currentTarget.value);
                }}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  if (renameError) {
                    setRenameError(null);
                  }
                }}
                onKeyDown={handleTitleInputKeyDown}
                className={cn(titleInputClassName, "w-full")}
                aria-label="Session title"
                disabled={isSavingTitle}
              />
            ) : (
              <p className="truncate text-sm font-medium text-foreground">
                {activeSession?.title ?? "No active session"}
              </p>
            )}
          </div>
        )}
        {renameError ? (
          <span className="chat-text-note shrink-0 text-destructive">Rename failed</span>
        ) : null}
        {activeSession ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                aria-label={`Session options for ${activeSession.title}`}
              >
                <DotsThree size={16} weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                if (!preventSessionMenuAutoFocusRef.current) return;

                event.preventDefault();
                preventSessionMenuAutoFocusRef.current = false;
              }}
            >
              {onRenameSession ? (
                <DropdownMenuItem onSelect={startSessionRename}>
                  <PencilSimple size={14} />
                  Rename session
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={handleExportSessionMarkdown}>
                <DownloadSimple size={14} />
                Export to MD
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onCloseSession(activeSession.id)}
                className="text-destructive focus:text-destructive"
              >
                <X size={14} />
                Close session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Messages area */}
      <div ref={scrollContainerRef} onScroll={handleScrollContainer} className="workspace-chat-content mx-3 flex-1 overflow-y-auto px-2 py-6 scrollbar-custom" style={chatContentStyle}>
        {isStartingNewSession ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <p className="max-w-[260px] text-sm text-muted-foreground">
              Starting a new conversation...
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <ChatCircle size={32} className="text-muted-foreground/30" />
            <p className="max-w-[240px] text-sm text-muted-foreground">
              Describe what you need and the agent will start working.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message, index) => {
              // Only show timestamp if this is the last message in a "same-minute" group
              // i.e., if there's no next message, or the next message is in a different minute
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
                    // Assistant messages: no bubble, full width
                    <div className="w-full text-sm leading-relaxed text-foreground">
                      {/* Render message parts if available, otherwise fall back to content */}
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
                                part={group.part}
                                onOpenFile={onOpenFile}
                                isPending={!!message.pending}
                                sessionTabs={sessionTabs}
                                onSelectSessionTab={onSelectSessionTab}
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
                              onClick={() =>
                                attachment.path ? onOpenFile(attachment.path) : undefined
                              }
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
                    // User messages: gray bubble
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
                              onClick={() =>
                                attachment.path ? onOpenFile(attachment.path) : undefined
                              }
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
            {/* Spacer so scroll-to-bottom still works when status moves to toolbar */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="mx-3 px-2 pb-4 pt-2">
        {/* Status, context & model selector row */}
        {(models.length > 0 || normalizedOpenFilePaths.length > 0 || currentStatus) && (
          <div className="mb-3 flex items-center gap-3">
            {/* Left slot: status when active, model selector when idle */}
            {currentStatus ? (
              <StatusIndicator currentStatus={currentStatus} connectorNamesById={connectorNamesById} />
            ) : models.length > 0 ? (
              <DropdownMenu onOpenChange={(open) => { if (!open) setModelSearch(""); }}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="max-w-[150px] truncate">
                      {selectedModel?.modelName ?? 'Select model'}
                    </span>
                    <CaretDown size={10} weight="bold" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 p-0">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                  <div className="scrollbar-custom max-h-64 overflow-y-auto p-1">
                    {models
                      .filter((model) => {
                        if (!modelSearch) return true;
                        const q = modelSearch.toLowerCase();
                        return (
                          model.modelName.toLowerCase().includes(q) ||
                          model.providerName.toLowerCase().includes(q) ||
                          model.modelId.toLowerCase().includes(q)
                        );
                      })
                      .map((model) => {
                        const isAgentDefault =
                          agentDefaultModel?.providerId === model.providerId &&
                          agentDefaultModel?.modelId === model.modelId;

                        return (
                          <DropdownMenuItem
                            key={`${model.providerId}-${model.modelId}`}
                            onClick={() => onSelectModel?.(model)}
                            className={cn(
                              selectedModel?.modelId === model.modelId &&
                              selectedModel?.providerId === model.providerId &&
                              "bg-primary/10"
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{model.modelName}</span>
                              <span className="text-xs text-muted-foreground">{model.providerName}</span>
                            </div>
                            {isAgentDefault ? (
                              <span className="ml-auto text-[10px] text-primary">Agent default</span>
                            ) : model.isDefault ? (
                              <span className="ml-auto text-[10px] text-muted-foreground">Provider default</span>
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })}
                    {models.length > 0 && modelSearch && models.every((m) => {
                      const q = modelSearch.toLowerCase();
                      return !(m.modelName.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q));
                    }) && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">No models found</p>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {/* Context button */}
            {normalizedOpenFilePaths.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Context
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-foreground/10"
                    >
                      <File size={12} weight="bold" className="text-primary/70" />
                      <span>
                        {contextMode === "off"
                          ? "Off"
                          : `${contextPathsToSend.length} ${contextPathsToSend.length === 1 ? "file" : "files"}`}
                      </span>
                      <CaretDown size={12} weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-80 rounded-lg p-1.5">
                    <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      Auto context
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        handleContextModeChange("auto");
                      }}
                      className={cn(
                        "justify-between rounded-md px-2.5 py-2 text-xs",
                        contextMode === "auto" && "bg-primary/10 text-primary"
                      )}
                    >
                      <span>Use all open files</span>
                      {contextMode === "auto" && <CheckCircle size={14} weight="fill" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        handleContextModeChange("manual");
                      }}
                      className={cn(
                        "justify-between rounded-md px-2.5 py-2 text-xs",
                        contextMode === "manual" && "bg-primary/10 text-primary"
                      )}
                    >
                      <span>Choose files manually</span>
                      {contextMode === "manual" && <CheckCircle size={14} weight="fill" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        handleContextModeChange("off");
                      }}
                      className={cn(
                        "justify-between rounded-md px-2.5 py-2 text-xs",
                        contextMode === "off" && "bg-primary/10 text-primary"
                      )}
                    >
                      <span>Disable auto context</span>
                      {contextMode === "off" && <CheckCircle size={14} weight="fill" />}
                    </DropdownMenuItem>

                    {contextMode === "manual" && (
                      <>
                        <DropdownMenuSeparator className="my-1.5" />
                        <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-muted-foreground">
                          <span>Open files</span>
                          <span>
                            {effectiveContextPaths.length}/{normalizedOpenFilePaths.length} selected
                          </span>
                        </div>
                        <div className="scrollbar-custom max-h-44 overflow-y-auto px-0.5 pb-0.5">
                          {normalizedOpenFilePaths.map((path) => {
                            const isSelected = manualContextPaths.includes(path);

                            return (
                              <DropdownMenuItem
                                key={path}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  toggleManualContextPath(path);
                                }}
                                className={cn(
                                  "justify-between gap-2 rounded-md px-2.5 py-2",
                                  isSelected && "bg-primary/10 text-primary"
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate text-xs">{path}</span>
                                {isSelected && <CheckCircle size={14} weight="fill" className="shrink-0" />}
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <DropdownMenuSeparator className="my-1.5" />
                    <p className="px-2.5 pb-1 text-[11px] text-muted-foreground">
                      References only via @path. File contents are never auto-attached.
                    </p>
                    {effectiveContextPaths.length > contextPathsToSend.length && (
                      <p className="px-2.5 pb-1 text-[11px] text-muted-foreground">
                        Sending first {contextPathsToSend.length} references only.
                      </p>
                    )}
                    <DropdownMenuItem
                      onSelect={() => onShowContext?.()}
                      className="gap-2.5 rounded-md px-2.5 py-2"
                    >
                      <FolderOpen size={14} className="text-muted-foreground" />
                      <span className="text-xs">Open files panel</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        )}

        {isReadOnly ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-100">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-50/90">
              <Info size={16} weight="fill" className="text-amber-500 dark:text-amber-300" />
              <span>Subagent sessions are read-only. Return to the main conversation to continue chatting.</span>
            </div>
            {onReturnToMainConversation ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onReturnToMainConversation}
              >
                Main conversation
              </Button>
            ) : null}
          </div>
        ) : (
          <>
        {attachmentsEnabled && selectedAttachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedAttachments.map((attachment) => (
              <button
                key={attachment.path}
                type="button"
                onClick={() =>
                  setSelectedAttachmentPaths((previous) =>
                    previous.filter((path) => path !== attachment.path)
                  )
                }
                className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20"
                title="Remove attachment"
              >
                <File size={12} weight="bold" />
                <span>{attachment.name}</span>
                <X size={11} />
              </button>
            ))}
          </div>
        )}

        {attachmentsEnabled && attachmentsError && (
          <p className="mb-3 text-xs text-destructive">
            {attachmentsError.replace(/_/g, ' ')}
          </p>
        )}
        
        <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-foreground/5 px-2 py-2">
          {attachmentsEnabled && (
            <>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleAttachmentInputChange}
                disabled={isSending || isStartingNewSession || isUploadingAttachment}
              />
              <DropdownMenu
                open={isAttachmentMenuOpen}
                onOpenChange={(open) => {
                  setIsAttachmentMenuOpen(open);
                  if (open) {
                    void refreshAttachments();
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Manage attachments"
                    disabled={isSending || isStartingNewSession || !onSendMessage}
                  >
                    {isUploadingAttachment ? (
                      <SpinnerGap size={18} className="animate-spin" />
                    ) : (
                      <Plus size={18} weight="bold" />
                    )}
                    {selectedAttachmentPaths.length > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                        {selectedAttachmentPaths.length}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-72 rounded-lg p-1.5">
                  {isLoadingAttachments ? (
                    <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                      <SpinnerGap size={12} className="animate-spin" />
                      Loading files...
                    </div>
                  ) : recentAttachments.length === 0 ? (
                    <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">
                      No uploaded files yet
                    </div>
                  ) : (
                    <>
                      <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        Recent files
                      </DropdownMenuLabel>
                      {recentAttachments.map((attachment) => {
                        const isSelected = selectedAttachmentPaths.includes(attachment.path);
                        return (
                          <DropdownMenuItem
                            key={attachment.path}
                            onSelect={(event) => {
                              event.preventDefault();
                              toggleAttachmentSelection(attachment.path);
                            }}
                            className={cn(
                              "gap-2.5 rounded-md px-2.5 py-2",
                              isSelected && "bg-primary/10"
                            )}
                          >
                            <div className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                              isSelected ? "text-primary" : "text-muted-foreground"
                            )}>
                              {isSelected ? (
                                <CheckCircle size={16} weight="fill" />
                              ) : (
                                <File size={14} />
                              )}
                            </div>
                            <span className="min-w-0 flex-1 truncate text-xs">{attachment.name}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground/60">
                              {formatAttachmentSize(attachment.size)}
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </>
                  )}
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuItem
                    disabled={isUploadingAttachment || isMutatingAttachments}
                    onSelect={(event) => {
                      event.preventDefault();
                      attachmentInputRef.current?.click();
                    }}
                    className="gap-2.5 rounded-md px-2.5 py-2"
                  >
                    <UploadSimple size={14} className="text-muted-foreground" />
                    <span className="text-xs">Upload file</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isMutatingAttachments}
                    onSelect={(event) => {
                      event.preventDefault();
                      setAttachmentSearch("");
                      setIsAttachmentMenuOpen(false);
                      setIsManageAttachmentsOpen(true);
                    }}
                    className="gap-2.5 rounded-md px-2.5 py-2"
                  >
                    <FolderOpen size={14} className="text-muted-foreground" />
                    <span className="text-xs">Manage attachments</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handleTextareaPaste}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Type a message..."
            disabled={isStartingNewSession || !onSendMessage}
            rows={1}
          />
          <Button
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg",
              isSending && "bg-foreground/8 text-foreground hover:bg-foreground/12"
            )}
            disabled={
              isStartingNewSession
                ? true
                : isSending
                  ? !onAbortMessage
                  : isUploadingAttachment ||
                    (!inputValue.trim() && selectedAttachments.length === 0) ||
                    !onSendMessage
            }
            onClick={isSending ? onAbortMessage : handleSend}
            aria-label={isSending ? "Cancel response" : "Send message"}
          >
            {isStartingNewSession ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : isSending ? (
              <X size={16} weight="bold" />
            ) : (
              <PaperPlaneTilt size={16} weight="fill" />
            )}
          </Button>
        </div>
          </>
        )}

        {attachmentsEnabled && (
          <Dialog open={isManageAttachmentsOpen} onOpenChange={setIsManageAttachmentsOpen}>
            <DialogContent className="h-[88vh] w-[min(96vw,1100px)] max-w-none p-0">
              <div className="flex h-full flex-col">
                <DialogHeader className="border-b border-border px-6 py-4">
                  <DialogTitle>Manage attachments</DialogTitle>
                  <DialogDescription>
                    Select one or more files to include as context in your next message.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden px-6 py-4">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <MagnifyingGlass size={14} className="text-muted-foreground" />
                      <input
                        type="text"
                        value={attachmentSearch}
                        onChange={(event) => setAttachmentSearch(event.target.value)}
                        placeholder="Search attachments..."
                        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-2 text-xs text-foreground transition-colors hover:bg-foreground/10"
                      disabled={isMutatingAttachments || isUploadingAttachment}
                    >
                      <UploadSimple size={14} />
                      Upload
                    </button>
                  </div>

                  <div className="scrollbar-custom h-[calc(100%-3rem)] overflow-y-auto pr-1">
                    {filteredAttachments.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                        No attachments found.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredAttachments.map((attachment) => {
                          const isSelected = selectedAttachmentPaths.includes(attachment.path);
                          return (
                            <div
                              key={attachment.path}
                              className={cn(
                                "group/card relative flex min-h-[120px] flex-col rounded-xl border p-3 text-left transition-colors duration-200",
                                isSelected
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-card/40 hover:bg-card/60"
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => toggleAttachmentSelection(attachment.path)}
                                className="absolute inset-0 rounded-xl"
                                disabled={isMutatingAttachments}
                                aria-label={`Select ${attachment.name}`}
                              />
                              <div className="flex items-start gap-2">
                                <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                                  <File size={16} className={cn("absolute transition-opacity duration-200", isSelected ? "text-primary opacity-0" : "text-muted-foreground opacity-100")} />
                                  <CheckCircle size={16} weight="fill" className={cn("absolute transition-opacity duration-200", isSelected ? "text-primary opacity-100" : "opacity-0")} />
                                </span>
                                <span className="min-w-0 flex-1 break-all text-sm font-medium text-foreground">
                                  {attachment.name}
                                </span>
                                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRenameAttachment(attachment);
                                    }}
                                    className="relative z-10 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-foreground/10 hover:text-foreground"
                                    title="Rename"
                                    disabled={isMutatingAttachments}
                                  >
                                    <PencilSimple size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteAttachment(attachment);
                                    }}
                                    className="relative z-10 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete"
                                    disabled={isMutatingAttachments}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-auto flex items-center justify-between pt-3 text-[11px] text-muted-foreground">
                                <span>{formatAttachmentSize(attachment.size)}</span>
                                <span>{new Date(attachment.uploadedAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {selectedAttachmentPaths.length > 0 && (
                  <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
                    <span className="text-xs text-muted-foreground">
                      {selectedAttachmentPaths.length} {selectedAttachmentPaths.length === 1 ? "file" : "files"} selected
                    </span>
                    <Button
                      size="sm"
                      onClick={() => setIsManageAttachmentsOpen(false)}
                    >
                      <Paperclip size={14} />
                      Attach {selectedAttachmentPaths.length} {selectedAttachmentPaths.length === 1 ? "file" : "files"}
                    </Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
