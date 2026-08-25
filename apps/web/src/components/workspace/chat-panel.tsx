"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BookOpenText,
  CaretDown,
  Check,
  CheckCircle,
  File,
  FolderOpen,
  Info,
  Lightning,
  MagnifyingGlass,
  Paperclip,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  SpinnerGap,
  UploadSimple,
  X,
} from "@phosphor-icons/react";

import { AgentMentionAutocomplete } from "@/components/workspace/chat-panel/agent-mention-autocomplete";
import { ChatPanelMessages } from "@/components/workspace/chat-panel/messages";
import { ChatPanelSessionHeader } from "@/components/workspace/chat-panel/session-header";
import type { SessionTabInfo } from "@/components/workspace/chat-panel/types";
import { WorkspaceChatEmptyComposer } from "@/components/workspace/workspace-chat-empty-composer";
import { StatusIndicator } from "@/components/workspace/bitmap-status-indicator";
import { GlyphAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FlowHumanResponsePanel } from "@/components/flows/flow-human-response-panel";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { useAgentMentionAutocomplete } from "@/hooks/use-agent-mention-autocomplete";
import type { SkillListItem } from "@/hooks/use-skills-catalog";
import type { AgentCatalogItem } from "@/hooks/use-workspace";
import type { WorkspacePermission } from "@/lib/opencode/permission";
import type { AvailableModel, PermissionResponse } from "@/lib/opencode/types";
import { getDesktopPlatform, getOptionalDesktopBridge } from "@/lib/runtime/desktop/client";
import {
  buildWorkspaceSessionMarkdown,
  getWorkspaceSessionExportFilename,
} from "@/lib/workspace-session-export";
import {
  formatAttachmentSize,
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_ATTACHMENT_UPLOAD_MEGABYTES,
} from "@/lib/workspace-attachments";
import { cn } from "@/lib/utils";
import type {
  ChatMessage,
  ChatSession,
  MessageAttachmentInput,
  WorkspaceAttachment,
} from "@/types/workspace";

type ChatPanelProps = {
  slug: string;
  agents?: AgentCatalogItem[];
  attachmentsEnabled?: boolean;
  contextFilePaths?: string[];
  recentUpdates?: { fileName: string; filePath: string }[];
  sessions: ChatSession[];
  skills?: SkillListItem[];
  messages: ChatMessage[];
  permissions?: WorkspacePermission[];
  activeSessionId: string | null;
  sessionTabs?: SessionTabInfo[];
  openFilePaths: string[];
  onCloseSession: (id: string) => void;
  onLearnSession?: (session: ChatSession) => Promise<void> | void;
  onRenameSession?: (id: string, title: string) => Promise<boolean>;
  onSelectSessionTab?: (id: string) => void;
  onOpenFile: (path: string) => void;
  onSendMessage?: (
    text: string,
    model?: { providerId: string; modelId: string },
    options?: { attachments?: MessageAttachmentInput[]; contextPaths?: string[] }
  ) => Promise<boolean>;
  onAnswerPermission?: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse
  ) => Promise<boolean>;
  onAbortMessage?: () => Promise<void> | void;
  isInitialSessionsReady?: boolean;
  isLoadingMessages?: boolean;
  sessionsError?: string | null;
  isSending?: boolean;
  isStartingNewSession?: boolean;
  models?: AvailableModel[];
  agentDefaultModel?: AvailableModel | null;
  selectedModel?: AvailableModel | null;
  hasManualModelSelection?: boolean;
  onSelectModel?: (model: AvailableModel | null) => void;
  isReadOnly?: boolean;
  readOnlyNotice?: string;
  flowHumanResponseRunId?: string | null;
  onFlowHumanResponseSubmitted?: () => Promise<void> | void;
  onReturnToMainConversation?: () => void;
  workspaceRoot?: string;
};

type ConnectorSummary = {
  id: string;
  name: string;
};

type AttachmentUploadFailure = {
  name: string;
  error: string;
};

const MAX_CONTEXT_PATHS_PER_MESSAGE = 20;
const EMPTY_AGENTS: AgentCatalogItem[] = [];
const EMPTY_CONTEXT_FILE_PATHS: string[] = [];
const EMPTY_MODELS: AvailableModel[] = [];
const EMPTY_PERMISSIONS: WorkspacePermission[] = [];
const EMPTY_SESSION_TABS: SessionTabInfo[] = [];
const EMPTY_SKILLS: SkillListItem[] = [];

function getAttachmentErrorMessage(error: string): string {
  switch (error) {
    case "attachments_load_failed":
      return "Couldn't load attachments.";
    case "file_too_large":
      return `You can't upload files larger than ${MAX_ATTACHMENT_UPLOAD_MEGABYTES} MB.`;
    case "too_many_files":
      return `You can upload up to ${MAX_ATTACHMENTS_PER_UPLOAD} files at a time.`;
    case "upload_partial_failure":
      return "Some files couldn't be uploaded.";
    case "upload_failed":
      return "Couldn't upload the selected file.";
    case "reveal_attachments_failed":
      return "Couldn't open the attachments folder.";
    default:
      return error.replace(/_/g, " ");
  }
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

async function fetchWorkspaceAttachments(slug: string): Promise<{
  attachments: WorkspaceAttachment[];
  error?: string;
  ok: boolean;
}> {
  const response = await fetch(`/api/w/${slug}/attachments`, {
    cache: "no-store",
  });
  const data = (await response
    .json()
    .catch(() => null)) as { attachments?: WorkspaceAttachment[]; error?: string } | null;

  if (!response.ok || !data?.attachments) {
    return {
      attachments: [],
      error: data?.error ?? "attachments_load_failed",
      ok: false,
    };
  }

  return {
    attachments: data.attachments,
    ok: true,
  };
}

export function ChatPanel({
  slug,
  agents = EMPTY_AGENTS,
  attachmentsEnabled = true,
  contextFilePaths = EMPTY_CONTEXT_FILE_PATHS,
  recentUpdates,
  sessions,
  skills = EMPTY_SKILLS,
  messages,
  permissions = EMPTY_PERMISSIONS,
  activeSessionId,
  sessionTabs = EMPTY_SESSION_TABS,
  openFilePaths,
  onCloseSession,
  onLearnSession,
  onRenameSession,
  onSelectSessionTab,
  onOpenFile,
  onSendMessage,
  onAnswerPermission,
  onAbortMessage,
  isInitialSessionsReady = true,
  isLoadingMessages = false,
  sessionsError = null,
  isSending = false,
  isStartingNewSession = false,
  models = EMPTY_MODELS,
  agentDefaultModel,
  selectedModel,
  hasManualModelSelection = false,
  onSelectModel,
  isReadOnly = false,
  readOnlyNotice,
  flowHumanResponseRunId,
  onFlowHumanResponseSubmitted,
  onReturnToMainConversation,
  workspaceRoot,
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
  const [selectedExpertId, setSelectedExpertId] = useState<string | null>(null);
  const [selectedSkillNames, setSelectedSkillNames] = useState<Set<string>>(() => new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [attachmentUploadFailures, setAttachmentUploadFailures] = useState<AttachmentUploadFailure[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isManageAttachmentsOpen, setIsManageAttachmentsOpen] = useState(false);
  const [attachmentSearch, setAttachmentSearch] = useState("");
  const [selectedAttachmentPaths, setSelectedAttachmentPaths] = useState<string[]>([]);
  const [isMutatingAttachments, setIsMutatingAttachments] = useState(false);
  const [manualContextPaths, setManualContextPaths] = useState<string[]>([]);
  const [contextSearch, setContextSearch] = useState("");
  const contextSearchInputRef = useRef<HTMLInputElement>(null);
  const [connectorNamesById, setConnectorNamesById] = useState<Record<string, string>>({});
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const desktopBridge = getOptionalDesktopBridge();
  const revealAttachmentsLabel = getDesktopPlatform() === "darwin"
    ? "Reveal in Finder"
    : "Reveal in File Explorer";

  const selectedAttachments = useMemo(
    () => {
      if (!attachmentsEnabled) return [];

      return selectedAttachmentPaths
        .map((path) => attachments.find((attachment) => attachment.path === path))
        .filter((attachment): attachment is WorkspaceAttachment => Boolean(attachment));
    },
    [attachments, attachmentsEnabled, selectedAttachmentPaths]
  );

  const normalizedOpenFilePaths = useMemo(() => {
    const uniquePaths = new Set<string>();
    const normalized: string[] = [];
    for (const path of [...openFilePaths, ...contextFilePaths]) {
      const trimmedPath = path.trim();
      if (!trimmedPath || uniquePaths.has(trimmedPath)) continue;
      uniquePaths.add(trimmedPath);
      normalized.push(trimmedPath);
    }
    return normalized;
  }, [contextFilePaths, openFilePaths]);

  const openFilePathSet = useMemo(
    () => new Set(normalizedOpenFilePaths),
    [normalizedOpenFilePaths]
  );

  const isEditingActiveSessionTitle = Boolean(
    activeSession && editingSessionId === activeSession.id
  );
  const canFocusComposer = !isReadOnly && !isStartingNewSession && Boolean(onSendMessage);
  const {
    agentMentionAutocomplete,
    clearAgentMentionAutocomplete,
    handleInputChange,
    handleMentionKeyDown,
    handleTextareaBlur,
    handleTextareaKeyUp,
    handleTextareaSelectionChange,
    onAgentMentionSelect,
  } = useAgentMentionAutocomplete({
    agents,
    inputValue,
    isReadOnly,
    setInputValue,
    textareaRef,
  });

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

  useEffect(() => {
    if (!isAttachmentMenuOpen) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      contextSearchInputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isAttachmentMenuOpen]);

  const effectiveContextPaths = useMemo(
    () => manualContextPaths.filter((path) => openFilePathSet.has(path)),
    [manualContextPaths, openFilePathSet]
  );

  const filteredContextPaths = useMemo(() => {
    const query = contextSearch.trim().toLowerCase();
    if (!query) return normalizedOpenFilePaths;
    return normalizedOpenFilePaths.filter((path) => path.toLowerCase().includes(query));
  }, [contextSearch, normalizedOpenFilePaths]);

  const contextPathsToSend = useMemo(
    () => effectiveContextPaths.slice(0, MAX_CONTEXT_PATHS_PER_MESSAGE),
    [effectiveContextPaths]
  );

  const attachTotalSelectedCount =
    selectedAttachmentPaths.length + effectiveContextPaths.length;

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

  const clearAllAttachSelections = useCallback(() => {
    setManualContextPaths([]);
    setSelectedAttachmentPaths([]);
  }, []);

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
      setAttachmentUploadFailures([]);
      setIsLoadingAttachments(false);
      return;
    }

    setIsLoadingAttachments(true);
    try {
      const data = await fetchWorkspaceAttachments(slug);

      if (!data.ok) {
        setAttachmentsError(data.error ?? "attachments_load_failed");
        setAttachmentUploadFailures([]);
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
      setAttachmentUploadFailures([]);
    } catch {
      setAttachmentsError("attachments_load_failed");
      setAttachmentUploadFailures([]);
    } finally {
      setIsLoadingAttachments(false);
    }
  }, [attachmentsEnabled, slug]);

  useEffect(() => {
    if (!attachmentsEnabled) return;

    let cancelled = false;

    async function loadInitialAttachments() {
      try {
        const data = await fetchWorkspaceAttachments(slug);
        if (cancelled) return;

        if (!data.ok) {
          setAttachmentsError(data.error ?? "attachments_load_failed");
          setAttachmentUploadFailures([]);
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
        setAttachmentUploadFailures([]);
      } catch {
        if (!cancelled) {
          setAttachmentsError("attachments_load_failed");
          setAttachmentUploadFailures([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAttachments(false);
        }
      }
    }

    void loadInitialAttachments();

    return () => {
      cancelled = true;
    };
  }, [attachmentsEnabled, slug]);

  const toggleAttachmentSelection = useCallback((path: string) => {
    setSelectedAttachmentPaths((previous) => {
      if (previous.includes(path)) {
        return previous.filter((entry) => entry !== path);
      }
      return [...previous, path];
    });
  }, []);

  const toggleSkillSelection = useCallback((name: string) => {
    setSelectedSkillNames((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleUploadAttachments = useCallback(async (files: File[]) => {
    if (!attachmentsEnabled || files.length === 0) return;

    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
      setAttachmentUploadFailures([]);
      setAttachmentsError("too_many_files");
      return;
    }

    setIsUploadingAttachment(true);
    setAttachmentsError(null);
    setAttachmentUploadFailures([]);

    const failedUploads: AttachmentUploadFailure[] = [];
    let nextError: string | null = null;
    let shouldRefreshAttachments = false;

    try {
      const uploaded: WorkspaceAttachment[] = [];
      let firstError: string | null = null;

      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
          failedUploads.push({ name: file.name, error: "file_too_large" });
          firstError ??= "file_too_large";
          continue;
        }

        const headers = file.type ? { "Content-Type": file.type } : undefined;

        try {
          shouldRefreshAttachments = true;
          const response = await fetch(
            `/api/w/${slug}/attachments?filename=${encodeURIComponent(file.name)}`,
            {
              method: "POST",
              headers,
              body: file,
            }
          );

          const data = (await response
            .json()
            .catch(() => null)) as { attachment?: WorkspaceAttachment; error?: string } | null;

          if (response.status === 413) {
            failedUploads.push({ name: file.name, error: "file_too_large" });
            firstError ??= "file_too_large";
            continue;
          }

          if (!response.ok || !data?.attachment) {
            const error = data?.error ?? "upload_failed";
            failedUploads.push({ name: file.name, error });
            firstError ??= error;
            continue;
          }

          uploaded.push(data.attachment);
        } catch {
          failedUploads.push({ name: file.name, error: "upload_failed" });
          firstError ??= "upload_failed";
        }
      }

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

      nextError = firstError
        ? uploaded.length > 0
          ? "upload_partial_failure"
          : firstError
        : null;
    } catch {
      nextError = "upload_failed";
    } finally {
      if (shouldRefreshAttachments) {
        await refreshAttachments();
      }

      setAttachmentUploadFailures(failedUploads);

      if (nextError !== null || !shouldRefreshAttachments) {
        setAttachmentsError(nextError);
      }

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

  const handleRevealAttachmentsDirectory = useCallback(async () => {
    if (!desktopBridge) return;

    setAttachmentUploadFailures([]);
    setAttachmentsError(null);
    const result = await desktopBridge.revealAttachmentsDirectory();
    if (!result.ok) {
      setAttachmentsError(result.error ?? "reveal_attachments_failed");
    }
  }, [desktopBridge]);

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
      setAttachmentUploadFailures([]);
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
      setAttachmentUploadFailures([]);
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

  const recentAttachments = useMemo(() => {
    const query = contextSearch.trim().toLowerCase();
    if (!query) return attachments.slice(0, 5);
    return attachments.filter((attachment) =>
      attachment.name.toLowerCase().includes(query)
    );
  }, [attachments, contextSearch]);

  const filteredAttachments = useMemo(() => {
    const query = attachmentSearch.trim().toLowerCase();
    if (!query) return attachments;
    return attachments.filter((attachment) =>
      attachment.name.toLowerCase().includes(query)
    );
  }, [attachmentSearch, attachments]);

  // --- Smart auto-scroll: only follow when the user is at the bottom ---
  const SCROLL_BOTTOM_THRESHOLD = 80;
  const isProgrammaticScrollRef = useRef(false);
  const prevSessionIdRef = useRef(activeSessionId);

  const handleScrollContainer = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    isStuckToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    isStuckToBottomRef.current = true;
    isProgrammaticScrollRef.current = false;
  }, []);

  const followScrollIfStuck = useCallback(() => {
    if (!isStuckToBottomRef.current) return;
    scrollToBottom();
  }, [scrollToBottom]);

  const prevMessagesLengthRef = useRef(0);
  useLayoutEffect(() => {
    if (prevSessionIdRef.current !== activeSessionId) {
      prevSessionIdRef.current = activeSessionId;
      isStuckToBottomRef.current = true;
      prevMessagesLengthRef.current = 0;
    }

    const isInitialLoad = prevMessagesLengthRef.current === 0 && messages.length > 0;
    prevMessagesLengthRef.current = messages.length;

    if (isInitialLoad) {
      isStuckToBottomRef.current = true;
    }

    followScrollIfStuck();
  }, [activeSessionId, messages, permissions, followScrollIfStuck]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const inner = scroller.firstElementChild;
    if (!inner) return;

    const observer = new ResizeObserver(() => {
      followScrollIfStuck();
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [activeSessionId, followScrollIfStuck, messages.length]);

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
    const composerDirectives = [
      selectedExpertId ? `@${selectedExpertId}` : null,
      ...Array.from(selectedSkillNames).map((name) => `/${name}`),
    ].filter((value): value is string => Boolean(value));
    const messageText = composerDirectives.length > 0
      ? text
        ? `${composerDirectives.join(" ")}\n\n${text}`
        : composerDirectives.join(" ")
      : text;
    const hasSelectedAttachments = selectedAttachments.length > 0;
    if (
      (!messageText && !hasSelectedAttachments) ||
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

    const accepted = await onSendMessage(messageText, model, {
      attachments: messageAttachments,
      contextPaths: messageContextPaths,
    });

    if (!accepted) {
      textareaRef.current?.focus();
      return;
    }

    clearAgentMentionAutocomplete();
    setInputValue("");
    textareaRef.current?.focus();
    setSelectedAttachmentPaths([]);
    setSelectedExpertId(null);
    setSelectedSkillNames(new Set());
  }, [
    clearAgentMentionAutocomplete,
    contextPathsToSend,
    inputValue,
    isReadOnly,
    onSendMessage,
    isSending,
    isStartingNewSession,
    hasManualModelSelection,
    selectedModel,
    selectedExpertId,
    selectedAttachments,
    selectedSkillNames,
    isUploadingAttachment,
  ]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleMentionKeyDown(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleMentionKeyDown, handleSend]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!inputValue) {
      textarea.style.height = "auto";
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [inputValue]);

  // Get the current status from the last pending message (if any).
  // Only show transient statuses (thinking, tool calls) while actively streaming.
  // Error statuses from stale pending messages are hidden when no stream is active.
  const currentStatus = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.pending && lastMessage?.statusInfo) {
      if (lastMessage.statusInfo.status === "complete" || lastMessage.statusInfo.status === "idle") return null;
      if (lastMessage.statusInfo.status === "error" && !isSending) return null;
      return lastMessage.statusInfo;
    }
    // Session-status driven thinking chip: busy and the current turn's
    // assistant message has not started writing visible parts yet. Messages
    // are sorted by creation time, so the last message belongs to the in-flight
    // turn. OpenCode is the source of truth.
    if (isSending) {
      const assistantWriting =
        lastMessage?.role === "assistant" && (lastMessage.parts?.length ?? 0) > 0;
      if (!assistantWriting) {
        return { status: "thinking" as const };
      }
    }
    return null;
  }, [messages, isSending]);

  const titleInputClassName = cn(
    "h-8 min-w-[180px] rounded-md border bg-background/80 px-2.5 text-sm font-medium text-foreground outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0",
    renameError
      ? "border-destructive/40 focus-visible:ring-destructive/20"
      : "border-primary/20 focus-visible:ring-primary/20"
  );
  const hasComposerDirectives = Boolean(selectedExpertId) || selectedSkillNames.size > 0;
  // When no conversation is selected, the centered empty-state composer is
  // the only composer; the bottom input area is hidden to avoid duplication.
  const showsEmptyStateComposer = !activeSessionId && !isReadOnly && Boolean(onSendMessage);

  return (
    <div className="desktop-select-enabled flex h-full min-h-0 flex-col text-card-foreground">
      <ChatPanelSessionHeader
        activeSession={activeSession}
        canDeleteSession={!isReadOnly}
        canRenameSession={Boolean(onRenameSession) && !isReadOnly}
        draftTitle={draftTitle}
        editingSessionId={editingSessionId}
        ignoreNextTitleBlurRef={ignoreNextTitleBlurRef}
        isLoadingSession={!isInitialSessionsReady && !sessionsError}
        isSavingTitle={isSavingTitle}
        onCloseSession={onCloseSession}
        onExportSessionMarkdown={handleExportSessionMarkdown}
        onLearnSession={activeSession && onLearnSession ? () => onLearnSession(activeSession) : undefined}
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
        sessionLoadError={sessionsError}
        titleInputClassName={titleInputClassName}
        titleInputRef={titleInputRef}
      />

      <ChatPanelMessages
        chatContentStyle={chatContentStyle}
        connectorNamesById={connectorNamesById}
        emptyStateElement={
          !activeSessionId && !isReadOnly && onSendMessage ? (
            <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4">
              <WorkspaceChatEmptyComposer
                agents={agents}
                agentDefaultModel={agentDefaultModel}
                models={models}
                skills={skills}
                recentUpdates={recentUpdates}
                onSendMessage={onSendMessage}
                onSelectModel={onSelectModel}
                selectedModel={selectedModel}
              />
            </div>
          ) : undefined
        }
        isInitialSessionsReady={isInitialSessionsReady}
        isLoadingMessages={isLoadingMessages}
        isStartingNewSession={isStartingNewSession}
        isStreaming={isSending}
        messages={messages}
        permissions={permissions}
        messagesEndRef={messagesEndRef}
        onOpenFile={onOpenFile}
        onAnswerPermission={isReadOnly ? undefined : onAnswerPermission}
        onScrollContainer={handleScrollContainer}
        onSelectSessionTab={onSelectSessionTab}
        scrollContainerRef={scrollContainerRef}
        sessionTabs={sessionTabs}
        sessionsError={sessionsError}
        slug={slug}
        workspaceRoot={workspaceRoot}
      />

      {/* Input area: hidden while the empty-state composer is on screen so
          the workspace never shows two composers at once. */}
      {showsEmptyStateComposer ? null : (
      <div className="mx-auto w-full max-w-[800px] px-5 pb-4 pt-2">
        {currentStatus ? (
          <div className={cn(
            "flex items-center gap-3",
            currentStatus.detail === "permission_required" ? "mb-2" : "mb-3",
          )}>
            <StatusIndicator currentStatus={currentStatus} connectorNamesById={connectorNamesById} />
          </div>
        ) : null}

        {isReadOnly ? (
          flowHumanResponseRunId ? (
            <FlowHumanResponsePanel
              runId={flowHumanResponseRunId}
              slug={slug}
              onSubmitted={onFlowHumanResponseSubmitted}
            />
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
              <div className="flex items-center gap-2 text-warning-foreground">
                <Info size={16} weight="fill" className="text-warning" />
                <span>{readOnlyNotice ?? "Subagent sessions are read-only. Return to the main conversation to continue chatting."}</span>
              </div>
              {onReturnToMainConversation ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-warning-foreground/30 bg-background/80 text-warning-foreground hover:bg-background"
                  onClick={onReturnToMainConversation}
                >
                  Main conversation
                </Button>
              ) : null}
            </div>
          )
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
          <div className="mb-3 space-y-1 text-xs text-destructive">
            <p>{getAttachmentErrorMessage(attachmentsError)}</p>
            {attachmentUploadFailures.map((failure) => (
              <p key={`${failure.name}:${failure.error}`}>
                {`${failure.name}: ${getAttachmentErrorMessage(failure.error)}`}
              </p>
            ))}
          </div>
        )}
        
        <div className="relative rounded-2xl border-[0.5px] border-border/30 bg-card/70 px-2.5 pb-3 pt-2.5 shadow-subtle backdrop-blur-md transition-shadow focus-within:border-border/50 focus-within:shadow-md sm:px-3 sm:pb-3.5 sm:pt-3">
          {attachmentsEnabled && (
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleAttachmentInputChange}
              disabled={isSending || isStartingNewSession || isUploadingAttachment}
            />
          )}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onBlur={handleTextareaBlur}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onClick={handleTextareaSelectionChange}
            onPaste={handleTextareaPaste}
            onSelect={handleTextareaSelectionChange}
            onKeyUp={handleTextareaKeyUp}
            className="block min-h-[24px] w-full max-h-[180px] resize-none bg-transparent pl-1 pr-12 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 sm:min-h-[28px] sm:pr-0 sm:text-base sm:leading-6"
            placeholder="Type a message..."
            disabled={isStartingNewSession || !onSendMessage}
            rows={1}
          />
          <AgentMentionAutocomplete
            autocomplete={agentMentionAutocomplete}
            onSelect={onAgentMentionSelect}
          />
          <div className="mt-3 flex items-center gap-2 sm:mt-2 sm:items-end">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:items-end">
                <DropdownMenu
                  open={isAttachmentMenuOpen}
                  onOpenChange={(open) => {
                    setIsAttachmentMenuOpen(open);
                    if (!open) {
                      setContextSearch("");
                    }
                    if (open && attachmentsEnabled) {
                      void refreshAttachments();
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      attachTotalSelectedCount > 0
                        ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                        : "border-border/60 bg-foreground/5 text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
                    )}
                    aria-label="Attach files"
                    disabled={isSending || isStartingNewSession || !onSendMessage}
                  >
                    {isUploadingAttachment ? <SpinnerGap size={14} className="animate-spin" /> : <Plus size={14} weight="bold" />}
                    Attach
                    {attachTotalSelectedCount > 0 ? <span className="text-[11px] font-semibold">{attachTotalSelectedCount}</span> : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-80 rounded-lg p-0">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                    <input
                      ref={contextSearchInputRef}
                      type="text"
                      placeholder="Search files..."
                      value={contextSearch}
                      onChange={(event) => setContextSearch(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                  <div className="scrollbar-custom max-h-64 overflow-y-auto p-1.5">
                    {attachmentsEnabled && isLoadingAttachments && recentAttachments.length === 0 && filteredContextPaths.length === 0 ? (
                      <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                        <SpinnerGap size={12} className="animate-spin" />
                        Loading files...
                      </div>
                    ) : recentAttachments.length === 0 && filteredContextPaths.length === 0 ? (
                      <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">
                        {contextSearch.trim() ? "No matches" : "No files available"}
                      </p>
                    ) : (
                      <>
                        <DropdownMenuLabel className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                          Recent files
                        </DropdownMenuLabel>
                        {recentAttachments.map((attachment) => {
                          const isSelected = selectedAttachmentPaths.includes(attachment.path);
                          return (
                            <DropdownMenuItem
                              key={`attachment:${attachment.path}`}
                              onSelect={(event) => {
                                event.preventDefault();
                                toggleAttachmentSelection(attachment.path);
                              }}
                              className={cn("mb-0.5 gap-2 rounded-md px-2.5 py-2 last:mb-0", isSelected && "bg-primary/10 text-primary")}
                            >
                              <File size={14} className="shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate text-xs">{attachment.name}</span>
                              <span className="shrink-0 text-[10px] text-muted-foreground/60">{formatAttachmentSize(attachment.size)}</span>
                              {isSelected ? <CheckCircle size={14} weight="fill" className="shrink-0" /> : null}
                            </DropdownMenuItem>
                          );
                        })}
                        {filteredContextPaths.map((path) => {
                          const isSelected = manualContextPaths.includes(path);
                          return (
                            <DropdownMenuItem
                              key={`kb:${path}`}
                              onSelect={(event) => {
                                event.preventDefault();
                                toggleManualContextPath(path);
                              }}
                              className={cn("mb-0.5 gap-2 rounded-md px-2.5 py-2 last:mb-0", isSelected && "bg-primary/10 text-primary")}
                            >
                              <BookOpenText size={14} className="shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate text-xs">{path}</span>
                              {isSelected ? <CheckCircle size={14} weight="fill" className="shrink-0" /> : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </>
                    )}
                  </div>
                  {attachmentsEnabled || attachTotalSelectedCount > 0 ? (
                    <div className="space-y-0.5 border-t border-border p-1.5">
                      {attachmentsEnabled ? (
                        <>
                          <DropdownMenuItem
                            disabled={isUploadingAttachment || isMutatingAttachments}
                            onSelect={(event) => {
                              event.preventDefault();
                              attachmentInputRef.current?.click();
                            }}
                            className="gap-2 rounded-md px-2.5 py-2"
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
                            className="gap-2 rounded-md px-2.5 py-2"
                          >
                            <FolderOpen size={14} className="text-muted-foreground" />
                            <span className="text-xs">Manage attachments</span>
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {attachTotalSelectedCount > 0 ? (
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            clearAllAttachSelections();
                          }}
                          className="gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground focus:text-foreground"
                        >
                          <X size={13} weight="bold" />
                          <span className="text-xs">Clear selection</span>
                        </DropdownMenuItem>
                      ) : null}
                    </div>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      selectedExpertId
                        ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                        : "border-border/60 bg-foreground/5 text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
                    )}
                  >
                    <Robot size={14} weight="regular" />
                    Experts
                    {selectedExpertId ? <span className="text-[11px] font-semibold">1</span> : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-80 rounded-lg p-1.5">
                  {agents.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">No experts available yet.</p> : null}
                  {agents.map((agent) => {
                    const isSelected = selectedExpertId === agent.id;
                    return (
                      <DropdownMenuItem
                        key={agent.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          setSelectedExpertId((current) => current === agent.id ? null : agent.id);
                        }}
                        className={cn("gap-3 rounded-md px-3 py-2", isSelected && "bg-primary/10 text-primary")}
                      >
                        <GlyphAvatar
                          seed={agent.id}
                          kind="agent"
                          size={28}
                          active={isSending && agent.id === selectedExpertId}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{agent.displayName}</span>
                        {isSelected ? <Check size={14} weight="bold" /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      selectedSkillNames.size > 0
                        ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                        : "border-border/60 bg-foreground/5 text-foreground/80 hover:bg-foreground/10 hover:text-foreground"
                    )}
                  >
                    <Lightning size={14} weight="regular" />
                    Skills
                    {selectedSkillNames.size > 0 ? <span className="text-[11px] font-semibold">{selectedSkillNames.size}</span> : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-80 rounded-lg p-1.5">
                  {skills.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">No skills available yet.</p> : null}
                  {skills.map((skill) => {
                    const isSelected = selectedSkillNames.has(skill.name);
                    return (
                      <DropdownMenuItem
                        key={skill.name}
                        onSelect={(event) => {
                          event.preventDefault();
                          toggleSkillSelection(skill.name);
                        }}
                        className={cn("items-start gap-2.5 rounded-md px-3 py-2", isSelected && "bg-primary/10 text-primary")}
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-current/30">
                          {isSelected ? <Check size={11} weight="bold" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{skill.name}</span>
                          {skill.description ? <span className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</span> : null}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex shrink-0 items-end gap-2">
              {models.length > 0 ? (
                <DropdownMenu
                  onOpenChange={(open) => {
                    setIsModelMenuOpen(open);
                    if (!open) setModelSearch("");
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="hidden items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:flex">
                      <span className="truncate">{selectedModel?.modelName ?? "Select model"}</span>
                      <CaretDown size={11} weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-72 p-0">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
                      <input
                        ref={modelSearchInputRef}
                        type="text"
                        placeholder="Search models..."
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        onKeyDown={(event) => event.stopPropagation()}
                        className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                    <div className="scrollbar-custom max-h-64 overflow-y-auto p-1">
                      {models
                        .filter((model) => {
                          if (!modelSearch) return true;
                          const query = modelSearch.toLowerCase();
                          return model.modelName.toLowerCase().includes(query) || model.providerName.toLowerCase().includes(query) || model.modelId.toLowerCase().includes(query);
                        })
                        .map((model) => {
                          const isAgentDefault = agentDefaultModel?.providerId === model.providerId && agentDefaultModel?.modelId === model.modelId;
                          const isSelected = selectedModel?.modelId === model.modelId && selectedModel?.providerId === model.providerId;
                          return (
                            <DropdownMenuItem key={`${model.providerId}-${model.modelId}`} onClick={() => onSelectModel?.(model)} className={cn(isSelected && "bg-primary/10")}>
                              <div className="flex flex-col">
                                <span className="font-medium">{model.modelName}</span>
                                <span className="text-xs text-muted-foreground">{model.providerName}</span>
                              </div>
                              {isAgentDefault ? <span className="ml-auto text-[10px] text-primary">Agent default</span> : model.isDefault ? <span className="ml-auto text-[10px] text-muted-foreground">Provider default</span> : null}
                            </DropdownMenuItem>
                          );
                        })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Button
                size="icon"
                className={cn("h-8 w-8 rounded-lg", isSending && "bg-foreground/8 text-foreground hover:bg-foreground/12")}
                disabled={
                  isStartingNewSession
                    ? true
                    : isSending
                      ? !onAbortMessage
                      : isUploadingAttachment ||
                        (!inputValue.trim() && !hasComposerDirectives && selectedAttachments.length === 0) ||
                        !onSendMessage
                }
                onClick={isSending ? onAbortMessage : handleSend}
                aria-label={isSending ? "Cancel response" : "Send message"}
              >
                {isStartingNewSession ? <SpinnerGap size={16} className="animate-spin" /> : isSending ? <X size={16} weight="bold" /> : <PaperPlaneTilt size={16} weight="fill" />}
              </Button>
            </div>
          </div>
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
                    {desktopBridge ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRevealAttachmentsDirectory();
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-foreground/5 px-3 py-2 text-xs text-foreground transition-colors hover:bg-foreground/10"
                        disabled={isMutatingAttachments || isUploadingAttachment}
                      >
                        <FolderOpen size={14} />
                        {revealAttachmentsLabel}
                      </button>
                    ) : null}
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
      )}
    </div>
  );
}
