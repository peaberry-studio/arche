"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";
import {
  CaretDown,
  DownloadSimple,
  X,
} from "@phosphor-icons/react";

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
    <div className="flex min-h-12 shrink-0 items-center gap-2 pl-4 pr-2 py-2">
      <div className="min-w-0 flex-1">
        {isEditingActiveSessionTitle ? (
          renderTitleInput(cn(titleInputClassName, "w-full"))
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-0.5">
              {canRenameSession && activeSession ? (
                <button
                  type="button"
                  onClick={onStartSessionRename}
                  className="-ml-1.5 flex min-w-0 items-center rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-foreground/5"
                  aria-label={`Rename session ${activeSession.title}`}
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {activeSession.title}
                  </span>
                </button>
              ) : (
                <p className="truncate text-sm font-medium text-foreground">
                  {activeSession?.title ?? "No active session"}
                </p>
              )}
              {activeSession ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                      aria-label={`Session options for ${activeSession.title}`}
                    >
                      <CaretDown size={11} weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={4}
                    onCloseAutoFocus={(event) => {
                      if (!preventSessionMenuAutoFocusRef.current) return;

                      event.preventDefault();
                      preventSessionMenuAutoFocusRef.current = false;
                    }}
                  >
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
                      Delete session
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {activeSession?.autopilot ? (
              <p className="truncate text-xs text-muted-foreground">
                Autopilot run for {activeSession.autopilot.taskName}
              </p>
            ) : null}
          </>
        )}
      </div>

      {renameError ? (
        <span className="chat-text-note shrink-0 text-destructive">Rename failed</span>
      ) : null}
    </div>
  );
}
