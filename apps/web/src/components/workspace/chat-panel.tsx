"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import {
  CaretLeft,
  CaretRight,
  ChatCircle,
  Circle,
  DotsThree,
  File,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  X
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSession } from "@/types/workspace";

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
};

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
  onShowContext
}: ChatPanelProps) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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

  const scrollTabs = (direction: "left" | "right") => {
    const el = tabsRef.current;
    if (!el) return;
    const scrollAmount = 150;
    el.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth"
    });
  };

  return (
    <div className="flex h-full flex-col bg-background">
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

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <ChatCircle size={32} className="text-muted-foreground/30" />
            <p className="max-w-[240px] text-sm text-muted-foreground">
              Describe lo que necesitas y el agente empezará a trabajar.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-1.5",
                  message.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    message.role === "assistant"
                      ? "bg-muted/60 text-foreground"
                      : message.role === "user"
                        ? "bg-primary/15 text-foreground"
                        : "bg-muted/40 text-muted-foreground italic"
                  )}
                >
                  <p>{message.content}</p>
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
                <span className="px-1 text-[10px] text-muted-foreground/60">
                  {message.timestamp}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60">
        {openFilesCount > 0 ? (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
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
        ) : null}
        <div className={cn("p-4", openFilesCount > 0 && "pt-2")}>
          <div className="flex items-end gap-2.5 rounded-xl border border-border/60 bg-card/60 p-2.5">
            <textarea
              className="min-h-[64px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              placeholder="Escribe un mensaje..."
              disabled
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-lg"
              disabled
              aria-label="Enviar mensaje"
            >
              <PaperPlaneTilt size={16} weight="fill" />
            </Button>
          </div>
          {activeSession?.updatedAt ? (
            <p className="mt-2 px-1 text-[10px] text-muted-foreground/60">
              Última actualización: {activeSession.updatedAt}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
