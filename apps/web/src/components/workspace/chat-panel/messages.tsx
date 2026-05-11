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
import { ChatCircle, CheckCircle, Copy, File, Info, XCircle } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  FileGroup,
  MessagePartRenderer,
  ToolGroup,
  type FilePart,
  type ToolPart,
} from "@/components/workspace/chat-panel/message-part-renderer";
import type { SessionTabInfo } from "@/components/workspace/chat-panel/types";
import { workspaceMarkdownComponents } from "@/components/workspace/markdown-components";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { MessagePart, PermissionResponse } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/workspace";

type ChatPanelMessagesProps = {
  chatContentStyle: CSSProperties;
  connectorNamesById: Record<string, string>;
  isStartingNewSession: boolean;
  messages: ChatMessage[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onAnswerPermission?: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse
  ) => Promise<boolean>;
  onOpenFile: (path: string) => void;
  onScrollContainer: () => void;
  onSelectSessionTab?: (id: string) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sessionTabs: SessionTabInfo[];
  workspaceRoot?: string;
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

export function ChatPanelMessages({
  chatContentStyle,
  connectorNamesById,
  isStartingNewSession,
  messages,
  messagesEndRef,
  onAnswerPermission,
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
                                  onAnswerPermission={onAnswerPermission}
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
