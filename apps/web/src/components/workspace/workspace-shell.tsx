"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  chatMessages as initialMessages,
  chatSessions as initialSessions,
  defaultFilePath,
  workspaceDiffs,
  workspaceFiles,
  workspaceTree
} from "@/data/workspace-mock";
import type { ChatMessage, ChatSession } from "@/types/workspace";

import { ChatPanel } from "./chat-panel";
import { FileTreePanel } from "./file-tree-panel";
import { InspectorPanel } from "./inspector-panel";
import { PanelResizeHandle } from "./panel-resize-handle";
import { WorkspaceFooter } from "./workspace-footer";
import { WorkspaceHeader } from "./workspace-header";

type WorkspaceShellProps = {
  slug: string;
  initialFilePath?: string | null;
};

type StoredState = {
  activeFilePath?: string;
  activeSessionId?: string;
  sessions?: ChatSession[];
  messages?: ChatMessage[];
  leftWidth?: number;
  rightWidth?: number;
  leftRatio?: number;
  rightRatio?: number;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
};

const MIN_LEFT_PX = 200;
const MIN_RIGHT_PX = 320;
const MIN_CENTER_PX = 360;
const DEFAULT_LEFT_RATIO = 0.1;
const DEFAULT_RIGHT_RATIO = 0.3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getMinCenter = (containerWidth: number) =>
  Math.min(MIN_CENTER_PX, Math.max(0, containerWidth - MIN_LEFT_PX - MIN_RIGHT_PX));

const fitWidths = (containerWidth: number, leftWidth: number, rightWidth: number) => {
  const minCenter = getMinCenter(containerWidth);
  const maxLeft = Math.max(MIN_LEFT_PX, containerWidth - MIN_RIGHT_PX - minCenter);
  const maxRight = Math.max(MIN_RIGHT_PX, containerWidth - MIN_LEFT_PX - minCenter);

  let nextLeft = clamp(leftWidth, MIN_LEFT_PX, maxLeft);
  let nextRight = clamp(rightWidth, MIN_RIGHT_PX, maxRight);

  const total = nextLeft + nextRight + minCenter;
  if (total > containerWidth) {
    const overflow = total - containerWidth;
    const reducibleRight = Math.max(0, nextRight - MIN_RIGHT_PX);
    const reduceRight = Math.min(overflow, reducibleRight);
    nextRight -= reduceRight;
    const remaining = overflow - reduceRight;
    if (remaining > 0) {
      nextLeft = Math.max(MIN_LEFT_PX, nextLeft - remaining);
    }
  }

  return { left: nextLeft, right: nextRight, minCenter };
};

const getContainerWidth = (container: HTMLDivElement | null) => {
  if (container) {
    return container.getBoundingClientRect().width;
  }
  if (typeof window !== "undefined") {
    return window.innerWidth;
  }
  return MIN_LEFT_PX + MIN_RIGHT_PX + MIN_CENTER_PX;
};

const loadStoredState = (key: string): StoredState | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
};

const persistState = (key: string, state: StoredState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
};

const createSession = (title: string): ChatSession => ({
  id: `session-${Date.now()}`,
  title,
  status: "active",
  updatedAt: "Ahora",
  agent: "Agente principal"
});

const createSystemMessage = (sessionId: string, content: string): ChatMessage => ({
  id: `msg-${Date.now()}`,
  sessionId,
  role: "system",
  content,
  timestamp: "Ahora"
});

export function WorkspaceShell({ slug, initialFilePath }: WorkspaceShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const storageKey = `arche.workspace.${slug}.mock-state`;
  const [hasHydrated, setHasHydrated] = useState(false);

  const [leftWidth, setLeftWidth] = useState(MIN_LEFT_PX);
  const [rightWidth, setRightWidth] = useState(MIN_RIGHT_PX);
  const [minCenterWidth, setMinCenterWidth] = useState(MIN_CENTER_PX);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"preview" | "review">("preview");

  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  const [activeSessionId, setActiveSessionId] = useState(
    initialSessions[0]?.id ?? "session-01"
  );

  const [activeFilePath, setActiveFilePath] = useState(
    initialFilePath ?? defaultFilePath
  );

  useEffect(() => {
    const storedState = loadStoredState(storageKey);
    const containerWidth = getContainerWidth(containerRef.current);
    let leftCandidate = containerWidth * DEFAULT_LEFT_RATIO;
    let rightCandidate = containerWidth * DEFAULT_RIGHT_RATIO;

    if (storedState?.leftWidth) {
      leftCandidate = storedState.leftWidth;
    } else if (typeof storedState?.leftRatio === "number") {
      leftCandidate = containerWidth * storedState.leftRatio;
    }

    if (storedState?.rightWidth) {
      rightCandidate = storedState.rightWidth;
    } else if (typeof storedState?.rightRatio === "number") {
      rightCandidate = containerWidth * storedState.rightRatio;
    }

    const fitted = fitWidths(containerWidth, leftCandidate, rightCandidate);
    setLeftWidth(fitted.left);
    setRightWidth(fitted.right);
    setMinCenterWidth(fitted.minCenter);

    if (storedState) {
      if (storedState.sessions?.length) {
        setSessions(storedState.sessions);
      }
      if (storedState.messages?.length) {
        setMessages(storedState.messages);
      }
      if (storedState.activeSessionId) {
        setActiveSessionId(storedState.activeSessionId);
      }
      if (!initialFilePath && storedState.activeFilePath) {
        setActiveFilePath(storedState.activeFilePath);
      }
      if (typeof storedState.leftCollapsed === "boolean") {
        setLeftCollapsed(storedState.leftCollapsed);
      }
      if (typeof storedState.rightCollapsed === "boolean") {
        setRightCollapsed(storedState.rightCollapsed);
      }
    }
    setHasHydrated(true);
  }, [storageKey, initialFilePath]);

  useEffect(() => {
    if (!sessions.length) {
      const newSession = createSession("Nueva sesión");
      setSessions([newSession]);
      setMessages((prev) => [
        createSystemMessage(newSession.id, "Sesión creada automáticamente."),
        ...prev
      ]);
      setActiveSessionId(newSession.id);
    }
  }, [sessions.length]);

  useEffect(() => {
    if (sessions.length && !sessions.find((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (!hasHydrated) return;
    persistState(storageKey, {
      sessions,
      messages,
      activeSessionId,
      activeFilePath,
      leftWidth,
      rightWidth,
      leftCollapsed,
      rightCollapsed
    });
  }, [
    storageKey,
    sessions,
    messages,
    activeSessionId,
    activeFilePath,
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    hasHydrated
  ]);

  useEffect(() => {
    const pathParam = searchParams.get("path");
    if (pathParam && pathParam !== activeFilePath) {
      setActiveFilePath(pathParam);
      setRightCollapsed(false);
      setRightTab("preview");
    }
  }, [searchParams, activeFilePath]);

  const updateUrlPath = (path: string) => {
    const current = searchParams.get("path");
    if (current === path) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("path", path);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const activeMessages = useMemo(
    () => messages.filter((message) => message.sessionId === activeSessionId),
    [messages, activeSessionId]
  );

  const activeFile = useMemo(
    () => (activeFilePath ? workspaceFiles[activeFilePath] ?? null : null),
    [activeFilePath]
  );

  const handleSelectSession = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id === sessionId) return { ...session, status: "active" };
        if (session.status === "archived") return session;
        return { ...session, status: "idle" };
      })
    );
    setActiveSessionId(sessionId);
  };

  const handleCreateSession = () => {
    const newSession = createSession(`Sesión ${sessions.length + 1}`);
    setSessions((prev) => [newSession, ...prev.map((session) => ({
      ...session,
      status: session.status === "archived" ? session.status : "idle"
    }))]);
    setMessages((prev) => [
      createSystemMessage(newSession.id, "Sesión creada automáticamente."),
      ...prev
    ]);
    setActiveSessionId(newSession.id);
  };

  const handleCloseSession = (sessionId: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((session) => session.id !== sessionId);
      if (filtered.length === 0) {
        const newSession = createSession("Nueva sesión");
        setActiveSessionId(newSession.id);
        return [newSession];
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
    setMessages((prev) => prev.filter((msg) => msg.sessionId !== sessionId));
  };

  const handleOpenFile = (path: string) => {
    setActiveFilePath(path);
    setRightTab("preview");
    setRightCollapsed(false);
    updateUrlPath(path);
  };

  const handleResizeLeft = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;

    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveRight = rightCollapsed ? 0 : rightWidth;
      const maxLeft = Math.max(MIN_LEFT_PX, rect.width - effectiveRight - minCenter);
      const nextWidth = clamp(moveEvent.clientX - rect.left, MIN_LEFT_PX, maxLeft);
      setLeftWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleResizeRight = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;

    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const minCenter = getMinCenter(rect.width);
      const effectiveLeft = leftCollapsed ? 0 : leftWidth;
      const maxRight = Math.max(MIN_RIGHT_PX, rect.width - effectiveLeft - minCenter);
      const nextWidth = clamp(rect.right - moveEvent.clientX, MIN_RIGHT_PX, maxRight);
      setRightWidth(nextWidth);
      setMinCenterWidth(minCenter);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      <WorkspaceHeader
        slug={slug}
        status="active"
      />

      <div
        ref={containerRef}
        className="relative z-10 flex min-h-0 flex-1"
      >
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: leftCollapsed ? 0 : leftWidth,
            minWidth: leftCollapsed ? 0 : MIN_LEFT_PX
          }}
        >
          {!leftCollapsed ? (
            <FileTreePanel
              nodes={workspaceTree}
              activePath={activeFilePath}
              onSelect={handleOpenFile}
            />
          ) : null}
        </div>

        <PanelResizeHandle
          position="left"
          onPointerDown={handleResizeLeft}
          hidden={leftCollapsed}
        />

        <div className="flex min-w-0 flex-1 flex-col" style={{ minWidth: minCenterWidth }}>
          <ChatPanel
            sessions={sessions}
            messages={activeMessages}
            activeSessionId={activeSessionId}
            activeFilePath={activeFilePath}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onCloseSession={handleCloseSession}
            onOpenFile={handleOpenFile}
          />
        </div>

        <PanelResizeHandle
          position="right"
          onPointerDown={handleResizeRight}
          hidden={rightCollapsed}
        />

        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: rightCollapsed ? 0 : rightWidth,
            minWidth: rightCollapsed ? 0 : MIN_RIGHT_PX
          }}
        >
          {!rightCollapsed ? (
            <InspectorPanel
              activeTab={rightTab}
              onTabChange={setRightTab}
              activeFile={activeFile}
              diffs={workspaceDiffs}
              onOpenFile={handleOpenFile}
            />
          ) : null}
        </div>
      </div>

      <WorkspaceFooter
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={() => setLeftCollapsed((prev) => !prev)}
        onToggleRight={() => setRightCollapsed((prev) => !prev)}
      />
    </div>
  );
}
