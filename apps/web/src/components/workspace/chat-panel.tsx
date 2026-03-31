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
  CaretDown,
  CheckCircle,
  File,
  FolderOpen,
  Info,
  MagnifyingGlass,
  Paperclip,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  SpinnerGap,
  UploadSimple,
  X,
} from "@phosphor-icons/react";

import { ChatPanelMessages } from "@/components/workspace/chat-panel/messages";
import { ChatPanelSessionHeader } from "@/components/workspace/chat-panel/session-header";
import type { ContextMode, SessionTabInfo } from "@/components/workspace/chat-panel/types";
import { StatusIndicator } from "@/components/workspace/bitmap-status-indicator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import type { AvailableModel } from "@/lib/opencode/types";
import {
  buildWorkspaceSessionMarkdown,
  getWorkspaceSessionExportFilename,
} from "@/lib/workspace-session-export";
import { formatAttachmentSize } from "@/lib/workspace-attachments";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatSession,
  MessageAttachmentInput,
  WorkspaceAttachment,
} from "@/types/workspace";

type ChatPanelProps = {
  slug: string;
  attachmentsEnabled?: boolean;
  sessions: ChatSession[];
  messages: ChatMessage[];
  activeSessionId: string | null;
  sessionTabs?: SessionTabInfo[];
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

type ConnectorSummary = {
  id: string;
  name: string;
};

const MAX_CONTEXT_PATHS_PER_MESSAGE = 20;

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
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const preventSessionMenuAutoFocusRef = useRef(false);
  const ignoreNextTitleBlurRef = useRef(false);
  const [inputValue, setInputValue] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
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
  const canFocusComposer = !isReadOnly && !isStartingNewSession && Boolean(onSendMessage);

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

  useEffect(() => {
    if (!canFocusComposer) return;

    const frameId = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [activeSessionId, canFocusComposer]);

  useEffect(() => {
    if (!isModelMenuOpen) return;

    const frameId = requestAnimationFrame(() => {
      modelSearchInputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isModelMenuOpen]);

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
    <div className="desktop-select-enabled flex h-full min-h-0 flex-col text-card-foreground">
      <ChatPanelSessionHeader
        activeSession={activeSession}
        canRenameSession={Boolean(onRenameSession)}
        draftTitle={draftTitle}
        editingSessionId={editingSessionId}
        ignoreNextTitleBlurRef={ignoreNextTitleBlurRef}
        isSavingTitle={isSavingTitle}
        onCloseSession={onCloseSession}
        onExportSessionMarkdown={handleExportSessionMarkdown}
        onStartSessionRename={startSessionRename}
        onSubmitSessionRename={submitSessionRename}
        onTitleInputChange={(nextTitle) => {
          setDraftTitle(nextTitle);
          if (renameError) {
            setRenameError(null);
          }
        }}
        onTitleInputKeyDown={handleTitleInputKeyDown}
        preventSessionMenuAutoFocusRef={preventSessionMenuAutoFocusRef}
        renameError={renameError}
        titleInputClassName={titleInputClassName}
        titleInputRef={titleInputRef}
      />

      <ChatPanelMessages
        chatContentStyle={chatContentStyle}
        connectorNamesById={connectorNamesById}
        isStartingNewSession={isStartingNewSession}
        messages={messages}
        messagesEndRef={messagesEndRef}
        onOpenFile={onOpenFile}
        onScrollContainer={handleScrollContainer}
        onSelectSessionTab={onSelectSessionTab}
        scrollContainerRef={scrollContainerRef}
        sessionTabs={sessionTabs}
      />

      {/* Input area */}
      <div className="mx-auto w-full max-w-[800px] px-5 pb-4 pt-2">
        {/* Status, context & model selector row */}
        {(models.length > 0 || normalizedOpenFilePaths.length > 0 || currentStatus) && (
          <div className="mb-3 flex items-center gap-3">
            {/* Left slot: status when active, model selector when idle */}
            {currentStatus ? (
              <StatusIndicator currentStatus={currentStatus} connectorNamesById={connectorNamesById} />
            ) : models.length > 0 ? (
              <DropdownMenu
                onOpenChange={(open) => {
                  setIsModelMenuOpen(open);
                  if (!open) setModelSearch("");
                }}
              >
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
                <DropdownMenuContent
                  align="start"
                  className="w-72 p-0"
                >
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                    <input
                      ref={modelSearchInputRef}
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
