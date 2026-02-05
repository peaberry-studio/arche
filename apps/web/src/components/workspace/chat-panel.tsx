"use client";

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowClockwise,
  Brain,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Circle,
  Code,
  Copy,
  DotsThree,
  File,
  GitDiff,
  Info,
  Lightbulb,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Question,
  Robot,
  SpinnerGap,
  TreeStructure,
  Warning,
  Wrench,
  X,
  XCircle
} from "@phosphor-icons/react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSession } from "@/types/workspace";
import type { AvailableModel, MessagePart } from "@/lib/opencode/types";

type ChatPanelProps = {
  sessions: ChatSession[];
  messages: ChatMessage[];
  activeSessionId: string;
  openFilesCount: number;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onOpenFile: (path: string) => void;
  onShowContext?: () => void;
  // New props for real functionality
  onSendMessage?: (text: string, model?: { providerId: string; modelId: string }) => Promise<void>;
  isSending?: boolean;
  models?: AvailableModel[];
  selectedModel?: AvailableModel | null;
  onSelectModel?: (model: AvailableModel | null) => void;
};

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
    default:
      return {
        summary: fallbackTitle,
        label: fallbackTitle,
      };
  }
}

function ReasoningBlock({ text, isPending }: { text: string; isPending: boolean }) {
  const COLLAPSE_THRESHOLD = 280;
  const [isOpen, setIsOpen] = useState(() => isPending || text.length <= COLLAPSE_THRESHOLD);
  const autoCollapsedRef = useRef(false);
  const canCollapse = text.length > COLLAPSE_THRESHOLD;

  useEffect(() => {
    if (isPending) {
      setIsOpen(true);
      return;
    }
    if (!autoCollapsedRef.current && text.length > COLLAPSE_THRESHOLD) {
      setIsOpen(false);
      autoCollapsedRef.current = true;
    }
  }, [isPending, text.length]);

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
      {isOpen && (
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
  const headerDisplay = getToolDisplay(tool, lastPart?.state.input, lastPart?.state.title || lastPart?.name || toolLabel);
  const summary = totalCount > 1
    ? `${totalCount} ${totalCount === 1 ? "call" : "calls"}${headerDisplay.summary ? ` · ${headerDisplay.summary}` : ""}`
    : headerDisplay.summary || lastPart?.state.title || lastPart?.name || tool;
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
              const detail = getToolDisplay(tool, part.state.input, part.state.title || part.name);
              const title = detail.label || part.state.title || part.name;
              
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
                    {itemError && part.state.error && (
                      <div className="mt-0.5 text-[11px] text-destructive">{part.state.error}</div>
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
          <img 
            src={part.url} 
            alt="Imagen adjunta" 
            className="max-h-64 rounded-lg border border-border"
          />
        </div>
      );
    
    case 'step-start':
      // No renderizar - no aporta valor visual
      return null;
    
    case 'step-finish':
      // No renderizar - los tokens se muestran en el tooltip del timestamp
      return null;
    
    case 'patch':
      return (
        <div className="my-2 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs">
          <GitDiff size={14} className="text-primary" />
          <span>Cambios en {part.files.length} archivo{part.files.length !== 1 ? 's' : ''}</span>
        </div>
      );
    
    case 'agent':
      return (
        <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Robot size={12} className="text-primary" />
          <span>Agente: {part.name}</span>
        </div>
      );
    
    case 'subtask':
      return (
        <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <TreeStructure size={12} weight="fill" />
            <span>Subtarea → {part.agent}</span>
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
          <span>Reintentando (intento {part.attempt})...</span>
        </div>
      );
    
    case 'unknown':
      // Fallback: render raw data for debugging
      return (
        <div className="my-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Question size={12} />
            <span>Tipo desconocido: {part.originalType}</span>
          </div>
          <pre className="overflow-x-auto text-xs text-muted-foreground">
            {JSON.stringify(part.data, null, 2)}
          </pre>
        </div>
      );
    
    default:
      // TypeScript exhaustive check
      const _exhaustive: never = part;
      return null;
  }
}

export function ChatPanel({
  sessions,
  messages,
  activeSessionId,
  openFilesCount,
  onSelectSession,
  onCreateSession,
  onCloseSession,
  onRenameSession,
  onOpenFile,
  onShowContext,
  onSendMessage,
  isSending = false,
  models = [],
  selectedModel,
  onSelectModel
}: ChatPanelProps) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const tabsRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const updateScrollState = () => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [sessions]);

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

  const scrollTabs = (direction: "left" | "right") => {
    const el = tabsRef.current;
    if (!el) return;
    const scrollAmount = 150;
    el.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth"
    });
  };

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || !onSendMessage || isSending) return;
    
    setInputValue("");
    
    // Mantener el focus en el textarea
    textareaRef.current?.focus();
    
    const model = selectedModel 
      ? { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
      : undefined;
    
    await onSendMessage(text, model);
  }, [inputValue, onSendMessage, isSending, selectedModel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  // Get the current status from the last pending message (if any)
  const currentStatus = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.pending || !lastMessage?.statusInfo) return null;
    if (lastMessage.statusInfo.status === "complete" || lastMessage.statusInfo.status === "idle") return null;
    return lastMessage.statusInfo;
  }, [messages]);

  // Status indicator component - shown at the bottom of messages
  const StatusIndicator = () => {
    if (!currentStatus) return null;

    const { status, toolName, detail } = currentStatus;

    const statusConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
      thinking: {
        icon: <Brain size={14} className="animate-pulse" />,
        label: "Thinking...",
        className: "text-primary"
      },
      reasoning: {
        icon: <Lightbulb size={14} className="animate-pulse" />,
        label: "Reasoning...",
        className: "text-primary"
      },
      "tool-calling": {
        icon: <Wrench size={14} className="animate-spin" />,
        label: toolName ? `Using ${toolName}...` : "Running tool...",
        className: "text-primary"
      },
      writing: {
        icon: <PencilSimple size={14} className="animate-pulse" />,
        label: detail ? `Writing ${detail}...` : "Writing...",
        className: "text-primary"
      },
      error: {
        icon: <XCircle size={14} />,
        label: detail || "Failed to process",
        className: "text-destructive"
      }
    };

    const config = statusConfig[status];
    if (!config) return null;

    return (
      <div className={cn(
        "flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg bg-muted/30 w-fit",
        config.className
      )}>
        {config.icon}
        <span>{config.label}</span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col text-card-foreground">
      {/* Session tabs */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 pl-2 pr-2">
        {canScrollLeft && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => scrollTabs("left")}
            aria-label="Scroll left"
          >
            <CaretLeft size={14} weight="bold" />
          </Button>
        )}
        
        <div
          ref={tabsRef}
          className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group flex shrink-0 items-center gap-1 rounded-xl pl-2.5 pr-1 py-1 text-xs transition-colors",
                session.id === activeSessionId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className="flex items-center gap-1.5"
              >
                <Circle
                  size={6}
                  weight="fill"
                  className={cn(
                    session.status === "active"
                      ? "text-emerald-500"
                      : session.status === "idle"
                        ? "text-muted-foreground/50"
                        : "text-muted-foreground/30"
                  )}
                />
                <span className="font-medium">{session.title}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "ml-0.5 rounded p-0.5 transition-colors",
                      "opacity-0 group-hover:opacity-100",
                      "hover:bg-foreground/10",
                      session.id === activeSessionId && "opacity-100"
                    )}
                    aria-label={`Options for ${session.title}`}
                  >
                    <DotsThree size={14} weight="bold" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={4}>
                  <DropdownMenuItem
                    onClick={() => {
                      const newTitle = window.prompt("New name:", session.title);
                      if (newTitle && newTitle.trim()) {
                        onRenameSession(session.id, newTitle.trim());
                      }
                    }}
                  >
                    <PencilSimple size={14} />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onCloseSession(session.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <X size={14} />
                    Close
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        {canScrollRight && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => scrollTabs("right")}
            aria-label="Scroll right"
          >
            <CaretRight size={14} weight="bold" />
          </Button>
        )}

        <div className="h-5 w-px bg-border/40 mx-1" />
        
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onCreateSession}
          aria-label="New session"
        >
          <Plus size={16} weight="bold" />
        </Button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-custom">
        {messages.length === 0 ? (
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
            <StatusIndicator />
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/10 px-6 py-5">
        {/* Model selector and context - same row */}
        {(models.length > 0 || openFilesCount > 0) && (
          <div className="mb-3 flex items-center gap-4">
            {/* Model selector */}
            {models.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Model
                </span>
                <DropdownMenu>
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
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {models.map((model) => (
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
                        {model.isDefault && (
                          <span className="ml-auto text-[10px] text-primary">Default</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Context button */}
            {openFilesCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Context
                </span>
                <button
                  type="button"
                  onClick={onShowContext}
                  className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-foreground/10"
                >
                  <File size={12} weight="bold" className="text-primary/70" />
                  <span>{openFilesCount} {openFilesCount === 1 ? "file" : "files"}</span>
                </button>
              </div>
            )}
          </div>
        )}
        
        <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-foreground/5 px-2.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 text-sm leading-9 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Type a message..."
            disabled={isSending || !onSendMessage}
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            disabled={isSending || !inputValue.trim() || !onSendMessage}
            onClick={handleSend}
            aria-label="Send message"
          >
            {isSending ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <PaperPlaneTilt size={16} weight="fill" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
