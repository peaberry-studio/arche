"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";
import {
  DotsThree,
  DownloadSimple,
  PencilSimple,
  X,
} from "@phosphor-icons/react";

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
  canRenameSession: boolean;
  draftTitle: string;
  editingSessionId: string | null;
  ignoreNextTitleBlurRef: MutableRefObject<boolean>;
  isSavingTitle: boolean;
  onCloseSession: (id: string) => void;
  onExportSessionMarkdown: () => void;
  onStartSessionRename: () => void;
  onSubmitSessionRename: (rawTitle?: string) => Promise<void> | void;
  onTitleInputChange: (value: string) => void;
  onTitleInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  preventSessionMenuAutoFocusRef: MutableRefObject<boolean>;
  renameError: string | null;
  titleInputClassName: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
};

export function ChatPanelSessionHeader({
  activeSession,
  canRenameSession,
  draftTitle,
  editingSessionId,
  ignoreNextTitleBlurRef,
  isSavingTitle,
  onCloseSession,
  onExportSessionMarkdown,
  onStartSessionRename,
  onSubmitSessionRename,
  onTitleInputChange,
  onTitleInputKeyDown,
  preventSessionMenuAutoFocusRef,
  renameError,
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
    <div className="mt-2 flex min-h-11 shrink-0 items-center gap-2 border-b border-border/35 px-5 py-1">
      <div className="min-w-0 flex-1">
        {isEditingActiveSessionTitle ? (
          renderTitleInput(cn(titleInputClassName, "w-full"))
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {activeSession?.title ?? "No active session"}
            </p>
            {activeSession?.autopilot ? (
              <p className="truncate text-xs text-muted-foreground">
                Autopilot run for {activeSession.autopilot.taskName}
              </p>
            ) : null}
          </div>
        )}
      </div>

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
