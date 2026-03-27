"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";
import {
  ChatCircle,
  DotsThree,
  DownloadSimple,
  PencilSimple,
  SpinnerGap,
  TreeStructure,
  X,
  XCircle,
} from "@phosphor-icons/react";

import type { SessionTabInfo } from "@/components/workspace/chat-panel/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/types/workspace";

type ChatPanelSessionHeaderProps = {
  activeSession: ChatSession | undefined;
  activeSessionId: string | null;
  canRenameSession: boolean;
  draftTitle: string;
  editingSessionId: string | null;
  ignoreNextTitleBlurRef: MutableRefObject<boolean>;
  isSavingTitle: boolean;
  onCloseSession: (id: string) => void;
  onExportSessionMarkdown: () => void;
  onSelectSessionTab?: (id: string) => void;
  onStartSessionRename: () => void;
  onSubmitSessionRename: (rawTitle?: string) => Promise<void> | void;
  onTitleInputChange: (value: string) => void;
  onTitleInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  preventSessionMenuAutoFocusRef: MutableRefObject<boolean>;
  renameError: string | null;
  sessionTabs: SessionTabInfo[];
  titleInputClassName: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
};

export function ChatPanelSessionHeader({
  activeSession,
  activeSessionId,
  canRenameSession,
  draftTitle,
  editingSessionId,
  ignoreNextTitleBlurRef,
  isSavingTitle,
  onCloseSession,
  onExportSessionMarkdown,
  onSelectSessionTab,
  onStartSessionRename,
  onSubmitSessionRename,
  onTitleInputChange,
  onTitleInputKeyDown,
  preventSessionMenuAutoFocusRef,
  renameError,
  sessionTabs,
  titleInputClassName,
  titleInputRef,
}: ChatPanelSessionHeaderProps) {
  const isEditingActiveSessionTitle = Boolean(
    activeSession && editingSessionId === activeSession.id
  );

  const renderTitleInput = (className: string) => (
    <input
      ref={titleInputRef}
      value={draftTitle}
      onBlur={(event) => {
        if (ignoreNextTitleBlurRef.current) {
          ignoreNextTitleBlurRef.current = false;
          return;
        }

        void onSubmitSessionRename(event.currentTarget.value);
      }}
      onChange={(event) => {
        onTitleInputChange(event.target.value);
      }}
      onKeyDown={onTitleInputKeyDown}
      className={className}
      aria-label="Session title"
      disabled={isSavingTitle}
    />
  );

  return (
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
                    {renderTitleInput(cn(titleInputClassName, "w-[min(240px,45vw)] text-xs"))}
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
            renderTitleInput(cn(titleInputClassName, "w-full"))
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
            {canRenameSession ? (
              <DropdownMenuItem onSelect={onStartSessionRename}>
                <PencilSimple size={14} />
                Rename session
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onExportSessionMarkdown}>
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
  );
}
