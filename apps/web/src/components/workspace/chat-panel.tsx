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
        title="Copiar mensaje"
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
                  {tokenInfo.input.toLocaleString()} entrada · {tokenInfo.output.toLocaleString()} salida
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

/**
 * Renders a single message part based on its type.
 */
function MessagePartRenderer({ 
  part, 
  onOpenFile 
}: { 
  part: MessagePart; 
  onOpenFile: (path: string) => void;
}) {
  switch (part.type) {
    case 'text':
      return (
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {part.text}
          </ReactMarkdown>
        </div>
      );
    
    case 'reasoning':
      return (
        <div className="my-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <Lightbulb size={12} weight="fill" />
            <span>Razonamiento</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">
            {part.text}
          </p>
        </div>
      );
    
    case 'tool': {
      const isRunning = part.state.status === 'running' || part.state.status === 'pending';
      const isError = part.state.status === 'error';
      const isComplete = part.state.status === 'completed';
      
      return (
        <div className={cn(
          "my-2 rounded-lg border p-3",
          isError ? "border-destructive/20 bg-destructive/5" :
          "border-primary/20 bg-primary/5"
        )}>
          <div className="flex items-center gap-2">
            {isRunning && <SpinnerGap size={14} className="animate-spin text-primary" />}
            {isComplete && <CheckCircle size={14} weight="fill" className="text-primary" />}
            {isError && <XCircle size={14} weight="fill" className="text-destructive" />}
            <span className="text-xs font-medium">
              {part.state.status === 'completed' && part.state.title 
                ? part.state.title 
                : part.name}
            </span>
          </div>
          {isError && part.state.status === 'error' && (
            <p className="mt-1 text-xs text-destructive">{part.state.error}</p>
          )}
        </div>
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
        label: "Pensando...",
        className: "text-primary"
      },
      reasoning: {
        icon: <Lightbulb size={14} className="animate-pulse" />,
        label: "Razonando...",
        className: "text-primary"
      },
      "tool-calling": {
        icon: <Wrench size={14} className="animate-spin" />,
        label: toolName ? `Usando ${toolName}...` : "Ejecutando herramienta...",
        className: "text-primary"
      },
      writing: {
        icon: <PencilSimple size={14} className="animate-pulse" />,
        label: detail ? `Escribiendo ${detail}...` : "Escribiendo...",
        className: "text-primary"
      },
      error: {
        icon: <XCircle size={14} />,
        label: detail || "Error al procesar",
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
    <div className="flex h-full flex-col bg-background">
      {/* Session tabs */}
      <div className="flex h-12 items-center gap-1 border-b border-border/60 px-2">
        {canScrollLeft && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => scrollTabs("left")}
            aria-label="Scroll izquierda"
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
                "group flex shrink-0 items-center gap-1 rounded-md pl-2.5 pr-1 py-1 text-xs transition-colors",
                session.id === activeSessionId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
                    aria-label={`Opciones de ${session.title}`}
                  >
                    <DotsThree size={14} weight="bold" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={4}>
                  <DropdownMenuItem
                    onClick={() => {
                      const newTitle = window.prompt("Nuevo nombre:", session.title);
                      if (newTitle && newTitle.trim()) {
                        onRenameSession(session.id, newTitle.trim());
                      }
                    }}
                  >
                    <PencilSimple size={14} />
                    Renombrar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onCloseSession(session.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <X size={14} />
                    Cerrar
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
            aria-label="Scroll derecha"
          >
            <CaretRight size={14} weight="bold" />
          </Button>
        )}

        <div className="h-5 w-px bg-border/60 mx-1" />
        
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onCreateSession}
          aria-label="Nueva sesión"
        >
          <Plus size={16} weight="bold" />
        </Button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <ChatCircle size={32} className="text-muted-foreground/30" />
            <p className="max-w-[240px] text-sm text-muted-foreground">
              Describe lo que necesitas y el agente empezará a trabajar.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
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
                        <div className="space-y-1">
                          {message.parts.map((part, partIndex) => (
                            <MessagePartRenderer 
                              key={`${message.id}-part-${partIndex}`} 
                              part={part} 
                              onOpenFile={onOpenFile} 
                            />
                          ))}
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
      <div className="border-t border-border/60 p-4">
        {/* Model selector and context - same row */}
        {(models.length > 0 || openFilesCount > 0) && (
          <div className="mb-3 flex items-center gap-4">
            {/* Model selector */}
            {models.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Modelo
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      <span className="max-w-[200px] truncate">
                        {selectedModel 
                          ? `${selectedModel.providerName} / ${selectedModel.modelName}`
                          : 'Seleccionar modelo'}
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
                          <span className="ml-auto text-[10px] text-primary">Por defecto</span>
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
                  Contexto
                </span>
                <button
                  type="button"
                  onClick={onShowContext}
                  className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  <File size={12} weight="bold" className="text-primary/70" />
                  <span>{openFilesCount} {openFilesCount === 1 ? "archivo" : "archivos"}</span>
                </button>
              </div>
            )}
          </div>
        )}
        
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-2.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 text-sm leading-9 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Escribe un mensaje..."
            disabled={isSending || !onSendMessage}
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            disabled={isSending || !inputValue.trim() || !onSendMessage}
            onClick={handleSend}
            aria-label="Enviar mensaje"
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
