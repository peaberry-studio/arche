"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Circle,
  Copy,
  DotsThree,
  File,
  FolderOpen,
  GitDiff,
  Info,
  Lightbulb,
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
import { formatAttachmentSize } from "@/lib/workspace-attachments";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatSession,
  MessageAttachmentInput,
  WorkspaceAttachment
} from "@/types/workspace";
import type { AvailableModel, MessagePart } from "@/lib/opencode/types";

type ChatPanelProps = {
  slug: string;
  sessions: ChatSession[];
  messages: ChatMessage[];
  activeSessionId: string | null;
  sessionTabs?: Array<{ id: string; title: string; depth: number }>;
  openFilePaths: string[];
  onCloseSession: (id: string) => void;
  onSelectSessionTab?: (id: string) => void;
  onOpenFile: (path: string) => void;
  onShowContext?: () => void;
  // New props for real functionality
  onSendMessage?: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: { attachments?: MessageAttachmentInput[]; contextPaths?: string[] }
  ) => Promise<void>;
  isSending?: boolean;
  isStartingNewSession?: boolean;
  models?: AvailableModel[];
  agentDefaultModel?: AvailableModel | null;
  selectedModel?: AvailableModel | null;
  hasManualModelSelection?: boolean;
  onSelectModel?: (model: AvailableModel | null) => void;
  activeAgentName?: string | null;
  pendingInsert?: string | null;
  onPendingInsertConsumed?: () => void;
};

type ContextMode = "auto" | "manual" | "off";

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
      "text-[10px] text-muted-foreground/60",
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
  task: "Delegating task",
  todowrite: "Planning",
  todoread: "Reviewing plan"
};

function getToolLabel(tool: string) {
  return TOOL_LABELS[tool] ?? tool;
}

function getToolDisplay(tool: string, input?: Record<string, unknown>, fallbackTitle?: string): ToolDisplay {
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
      return {
        summary: [
          subagentType ? `agent=${subagentType}` : undefined,
          taskDescription,
        ].filter(Boolean).join(" · ") || fallbackTitle,
        label: subagentType ? `agent=${subagentType}` : fallbackTitle,
        meta: taskDescription,
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
  const COLLAPSE_THRESHOLD = 280;
  const [isOpen, setIsOpen] = useState(() => text.length <= COLLAPSE_THRESHOLD);
  const canCollapse = text.length > COLLAPSE_THRESHOLD;
  const displayedOpen = isPending ? true : isOpen;

  return (
    <div className="my-2 rounded-lg border border-primary/20 bg-primary/5">
      <button
        type="button"
        onClick={() => {
          if (!canCollapse) return;
          setIsOpen(prev => !prev);
        }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-xs font-medium",
          canCollapse ? "cursor-pointer" : "cursor-default"
        )}
      >
        <Lightbulb size={12} weight="fill" className="text-primary" />
        <span>Reasoning</span>
        {canCollapse && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            {isOpen ? "Hide" : "Show"}
            <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
          </span>
        )}
      </button>
      {displayedOpen && (
        <div className="px-3 pb-3">
          <p className="whitespace-pre-wrap text-sm text-foreground/80">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

function ToolGroup({
  tool,
  parts,
  onOpenFile
}: {
  tool: string;
  parts: ToolPart[];
  onOpenFile?: (path: string) => void;
}) {
  const getStateTitle = (state: ToolPart['state'] | undefined): string | undefined => {
    if (!state) return undefined;
    return 'title' in state && typeof state.title === 'string' ? state.title : undefined;
  };

  const getStateError = (state: ToolPart['state']): string | undefined => {
    return 'error' in state && typeof state.error === 'string' ? state.error : undefined;
  };

  const runningCount = parts.filter(p => p.state.status === "running" || p.state.status === "pending").length;
  const errorCount = parts.filter(p => p.state.status === "error").length;
  const completedCount = parts.filter(p => p.state.status === "completed").length;
  const totalCount = parts.length;

  const isRunning = runningCount > 0;
  const isError = errorCount > 0;
  const canExpand = totalCount > 1 || isError;

  const [isOpen, setIsOpen] = useState(() => (totalCount === 1 ? isRunning || isError : false));

  const toolLabel = getToolLabel(tool);
  const lastPart = parts[parts.length - 1];
  const headerDisplay = getToolDisplay(tool, lastPart?.state.input, getStateTitle(lastPart?.state) || lastPart?.name || toolLabel);
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
          "flex w-full items-center gap-2 px-3 py-2 text-xs",
          canExpand ? "cursor-pointer" : "cursor-default"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isRunning && <SpinnerGap size={12} className="animate-spin text-primary" />}
          {!isRunning && isError && <XCircle size={12} weight="fill" className="text-destructive" />}
          {!isRunning && !isError && <CheckCircle size={12} weight="fill" className="text-primary" />}
          <span className="font-medium">{toolLabel}</span>
          {showSummary && (
            <span className="min-w-0 truncate text-muted-foreground">
              {summary}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {totalCount > 1 && (
            <span className="text-[10px] text-muted-foreground">
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
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
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
              const detail = getToolDisplay(tool, part.state.input, getStateTitle(part.state) || part.name);
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
                          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Open
                          <CaretRight size={12} />
                        </span>
                      )}
                    </div>
                    {itemError && getStateError(part.state) && (
                      <div className="mt-0.5 text-[11px] text-destructive">{getStateError(part.state)}</div>
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
        className="flex w-full items-center gap-2 px-3 py-2 text-xs"
      >
        <File size={12} weight="bold" className="text-primary" />
        <span className="font-medium">Files</span>
        <span className="text-muted-foreground">{totalCount} {totalCount === 1 ? "file" : "files"}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
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
  isPending
}: { 
  part: MessagePart; 
  onOpenFile: (path: string) => void;
  isPending: boolean;
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
      return <ToolGroup tool={part.name} parts={[part]} onOpenFile={onOpenFile} />;
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
  sessions,
  messages,
  activeSessionId,
  sessionTabs = [],
  openFilePaths,
  onCloseSession,
  onSelectSessionTab,
  onOpenFile,
  onShowContext,
  onSendMessage,
  isSending = false,
  isStartingNewSession = false,
  models = [],
  agentDefaultModel,
  selectedModel,
  hasManualModelSelection = false,
  onSelectModel,
  activeAgentName,
  pendingInsert,
  onPendingInsertConsumed
}: ChatPanelProps) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
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

  const selectedAttachments = useMemo(
    () =>
      selectedAttachmentPaths
        .map((path) => attachments.find((attachment) => attachment.path === path))
        .filter((attachment): attachment is WorkspaceAttachment => Boolean(attachment)),
    [attachments, selectedAttachmentPaths]
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
  }, [slug]);

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
    if (files.length === 0) return;

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
  }, [refreshAttachments, slug]);

  const handleAttachmentInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      await handleUploadAttachments(Array.from(event.target.files ?? []));
      event.target.value = "";
    },
    [handleUploadAttachments]
  );

  const handleTextareaPaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isSending || isStartingNewSession || isUploadingAttachment || !onSendMessage) {
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

  // Auto-scroll to bottom when new messages arrive
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    const isInitialLoad = prevMessagesLengthRef.current === 0 && messages.length > 0;
    const behavior = isInitialLoad ? "instant" : "smooth";
    messagesEndRef.current?.scrollIntoView({ behavior });
    prevMessagesLengthRef.current = messages.length;
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
      !onSendMessage ||
      isSending ||
      isStartingNewSession ||
      isUploadingAttachment
    ) return;
    
    setInputValue("");
    
    // Mantener el focus en el textarea
    textareaRef.current?.focus();
    
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
    
    await onSendMessage(text, model, {
      attachments: messageAttachments,
      contextPaths: messageContextPaths,
    });
    setSelectedAttachmentPaths([]);
  }, [
    contextPathsToSend,
    inputValue,
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

  // Get the current status from the last pending message (if any)
  const currentStatus = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.pending || !lastMessage?.statusInfo) return null;
    if (lastMessage.statusInfo.status === "complete" || lastMessage.statusInfo.status === "idle") return null;
    return lastMessage.statusInfo;
  }, [messages]);

  return (
    <div className="flex h-full flex-col text-card-foreground">
      {/* Session header */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 pl-2 pr-2">
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-sm font-medium text-foreground">
            {activeSession?.title ?? "No active session"}
          </p>
        </div>
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
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem
                onClick={() => onCloseSession(activeSession.id)}
                className="text-destructive focus:text-destructive"
              >
                <X size={14} />
                Close session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {sessionTabs.length > 1 ? (
        <div className="border-b border-white/10 px-2 py-2">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {sessionTabs.map((sessionTab) => {
              const isSubtask = sessionTab.depth > 0;
              const isActive = sessionTab.id === activeSessionId;

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
                    <TreeStructure size={12} weight={isActive ? "fill" : "bold"} />
                  ) : (
                    <ChatCircle size={12} weight={isActive ? "fill" : "bold"} />
                  )}
                  <span className="max-w-[180px] truncate">{sessionTab.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-custom">
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
                      {/* Don't show anything for empty pending messages - status indicator is at the bottom */}
                      
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
            {/* Status indicator at the bottom - always visible when processing */}
            <StatusIndicator currentStatus={currentStatus} />
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/10 px-6 py-5">
        {/* Model selector and context - same row */}
        {(models.length > 0 || normalizedOpenFilePaths.length > 0 || activeAgentName) && (
          <div className="mb-3 flex items-center gap-4">
            {activeAgentName && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Agent
                </span>
                <span className="rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground">
                  {activeAgentName}
                </span>
              </div>
            )}

            {/* Model selector */}
            {models.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Model
                </span>
                <DropdownMenu onOpenChange={(open) => { if (!open) setModelSearch(""); }}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-foreground/10"
                    >
                      <span className="max-w-[200px] truncate">
                        {selectedModel
                          ? `${selectedModel.providerName} / ${selectedModel.modelName}`
                          : 'Select model'}
                      </span>
                      <CaretDown size={12} weight="bold" />
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
              </div>
            )}

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

        {selectedAttachments.length > 0 && (
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

        {attachmentsError && (
          <p className="mb-3 text-xs text-destructive">
            {attachmentsError.replace(/_/g, ' ')}
          </p>
        )}
        
        <div className="flex items-end gap-1.5 rounded-xl border border-white/10 bg-foreground/5 px-2 py-2">
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
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handleTextareaPaste}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Type a message..."
            disabled={isSending || isStartingNewSession || !onSendMessage}
            rows={1}
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg"
            disabled={
              isSending ||
              isStartingNewSession ||
              isUploadingAttachment ||
              (!inputValue.trim() && selectedAttachments.length === 0) ||
              !onSendMessage
            }
            onClick={handleSend}
            aria-label="Send message"
          >
            {isSending || isStartingNewSession ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <PaperPlaneTilt size={16} weight="fill" />
            )}
          </Button>
        </div>

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
      </div>
    </div>
  );
}
