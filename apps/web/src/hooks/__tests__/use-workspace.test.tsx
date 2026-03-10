/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "@/hooks/use-workspace";
import type { WorkspaceMessage } from "@/lib/opencode/types";

const opencodeMocks = vi.hoisted(() => ({
  checkConnectionAction: vi.fn(),
  listSessionsAction: vi.fn(),
  createSessionAction: vi.fn(),
  deleteSessionAction: vi.fn(),
  updateSessionAction: vi.fn(),
  listMessagesAction: vi.fn(),
  abortSessionAction: vi.fn(),
  loadFileTreeAction: vi.fn(),
  readFileAction: vi.fn(),
  getWorkspaceDiffsAction: vi.fn(),
  listModelsAction: vi.fn(),
}));

const workspaceAgentMocks = vi.hoisted(() => ({
  readWorkspaceFileAction: vi.fn(),
  writeWorkspaceFileAction: vi.fn(),
  deleteWorkspaceFileAction: vi.fn(),
  applyWorkspacePatchAction: vi.fn(),
  discardWorkspaceFileChangesAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);
vi.mock("@/actions/workspace-agent", () => workspaceAgentMocks);

function createPendingStreamBody() {
  let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | null = null;

  return {
    body: {
      getReader() {
        return {
          read: () =>
            new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
              resolveRead = resolve;
            }),
        };
      },
    },
    close() {
      resolveRead?.({ done: true, value: undefined });
    },
  };
}

describe("useWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    opencodeMocks.checkConnectionAction.mockResolvedValue({ status: "connected" });
    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "now" }],
    });
    opencodeMocks.createSessionAction.mockResolvedValue({
      ok: true,
      session: { id: "s2", title: "Fresh", status: "active", updatedAt: "now" },
    });
    opencodeMocks.deleteSessionAction.mockResolvedValue({ ok: true });
    opencodeMocks.updateSessionAction.mockResolvedValue({ ok: true });
    opencodeMocks.listMessagesAction.mockImplementation(async (_slug: string, sessionId: string) => {
      if (sessionId === "s1") {
        return {
          ok: true,
          messages: [
            {
              id: "m1",
              sessionId: "s1",
              role: "assistant",
              content: "Hi",
              timestamp: "now",
              agentId: "assistant",
              model: { providerId: "openai", modelId: "gpt-5.2" },
              parts: [],
              pending: false,
            },
          ],
        };
      }

      return { ok: true, messages: [] };
    });
    opencodeMocks.abortSessionAction.mockResolvedValue({ ok: true });
    opencodeMocks.loadFileTreeAction.mockResolvedValue({ ok: true, tree: [] });
    opencodeMocks.readFileAction.mockResolvedValue({ ok: false, error: "not_found" });
    opencodeMocks.getWorkspaceDiffsAction.mockResolvedValue({ ok: true, diffs: [] });
    opencodeMocks.listModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5.2",
          modelName: "GPT 5.2",
          isDefault: true,
        },
        {
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5.4",
          modelName: "GPT 5.4",
          isDefault: false,
        },
      ],
    });

    workspaceAgentMocks.readWorkspaceFileAction.mockResolvedValue({ ok: false, error: "not_found" });
    workspaceAgentMocks.writeWorkspaceFileAction.mockResolvedValue({ ok: true, hash: "hash" });
    workspaceAgentMocks.deleteWorkspaceFileAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.applyWorkspacePatchAction.mockResolvedValue({ ok: true });
    workspaceAgentMocks.discardWorkspaceFileChangesAction.mockResolvedValue({ ok: true });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/u/alice/agents") {
          return {
            ok: true,
            json: async () => ({
              agents: [
                {
                  id: "assistant",
                  displayName: "Assistant",
                  model: "openai/gpt-5.4",
                  isPrimary: true,
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("resets a new session to the primary agent model instead of the previous session runtime model", async () => {
    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.selectedModel?.modelId).toBe("gpt-5.2");
    });

    expect(result.current.activeAgentName).toBe("Assistant");
    expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
    expect(result.current.hasManualModelSelection).toBe(false);

    await act(async () => {
      await result.current.createSession("Fresh");
    });

    expect(result.current.activeSessionId).toBe("s2");
    expect(result.current.selectedModel?.modelId).toBe("gpt-5.4");
    expect(result.current.activeAgentName).toBe("Assistant");
    expect(result.current.hasManualModelSelection).toBe(false);
  });

  it("tracks manual model overrides separately from the agent default", async () => {
    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
    });

    act(() => {
      result.current.setSelectedModel({
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5.2",
        modelName: "GPT 5.2",
        isDefault: true,
      });
    });

    expect(result.current.selectedModel?.modelId).toBe("gpt-5.2");
    expect(result.current.hasManualModelSelection).toBe(true);
    expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
  });

  it("restores the stored active session on reload instead of defaulting to the first returned child session", async () => {
    localStorage.setItem("arche.workspace.alice.active-session", "root");
    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [
        {
          id: "child",
          title: "Child",
          status: "idle",
          updatedAt: "now",
          parentId: "root",
        },
        {
          id: "root",
          title: "Root",
          status: "idle",
          updatedAt: "now",
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("root");
    });
  });

  it("falls back to the first root session when no stored selection exists", async () => {
    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [
        {
          id: "child",
          title: "Child",
          status: "idle",
          updatedAt: "now",
          parentId: "root",
        },
        {
          id: "root",
          title: "Root",
          status: "idle",
          updatedAt: "now",
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("root");
    });
  });

  it("clears a manual model override when the model is no longer available", async () => {
    vi.useFakeTimers();
    opencodeMocks.checkConnectionAction
      .mockResolvedValueOnce({ status: "disconnected" })
      .mockResolvedValue({ status: "connected" });
    opencodeMocks.listModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5.2",
          modelName: "GPT 5.2",
          isDefault: true,
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    act(() => {
      result.current.setSelectedModel({
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5.4",
        modelName: "GPT 5.4",
        isDefault: false,
      });
    });

    expect(result.current.hasManualModelSelection).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    vi.useRealTimers();

    expect(result.current.hasManualModelSelection).toBe(false);
    expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
    expect(result.current.selectedModel?.modelId).toBe("gpt-5.2");
  });

  it("keeps the root session live while inspecting a subagent tab", async () => {
    localStorage.setItem("arche.workspace.alice.active-session", "root");

    const sessionMessages: Record<string, WorkspaceMessage[]> = {
      root: [],
      child: [
        {
          id: "child-message",
          sessionId: "child",
          role: "assistant",
          content: "Child progress",
          timestamp: "now",
          parts: [],
          pending: false,
        },
      ],
    };
    const stream = createPendingStreamBody();
    let streamSignal: AbortSignal | undefined;

    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [
        { id: "child", title: "Child", status: "idle", updatedAt: "now", parentId: "root" },
        { id: "root", title: "Root", status: "busy", updatedAt: "now" },
      ],
    });
    opencodeMocks.listMessagesAction.mockImplementation(async (_slug: string, sessionId: string) => ({
      ok: true,
      messages: sessionMessages[sessionId] ?? [],
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/u/alice/agents") {
          return {
            ok: true,
            json: async () => ({
              agents: [
                {
                  id: "assistant",
                  displayName: "Assistant",
                  model: "openai/gpt-5.4",
                  isPrimary: true,
                },
              ],
            }),
          };
        }

        if (String(input) === "/api/w/alice/chat/stream") {
          streamSignal = init?.signal as AbortSignal | undefined;
          return {
            ok: true,
            body: stream.body,
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("root");
    });

    act(() => {
      void result.current.sendMessage("Investigate this");
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    act(() => {
      result.current.selectSession("child");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("child");
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Child progress",
      ]);
    });

    expect(streamSignal?.aborted).toBe(false);

    act(() => {
      result.current.selectSession("root");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("root");
      expect(result.current.messages).toHaveLength(2);
    });

    sessionMessages.root = [
      {
        id: "user-message",
        sessionId: "root",
        role: "user",
        content: "Investigate this",
        timestamp: "now",
        parts: [{ type: "text", text: "Investigate this" }],
        pending: false,
      },
      {
        id: "assistant-message",
        sessionId: "root",
        role: "assistant",
        content: "Done now",
        timestamp: "now",
        parts: [{ type: "text", text: "Done now" }],
        pending: false,
      },
    ];

    act(() => {
      stream.close();
    });

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Investigate this",
        "Done now",
      ]);
    });
  });

  it("supports sending in another session while a previous session is still streaming", async () => {
    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [
        { id: "s1", title: "First", status: "idle", updatedAt: "now" },
        { id: "s2", title: "Second", status: "idle", updatedAt: "now" },
      ],
    });
    opencodeMocks.listMessagesAction.mockImplementation(async (_slug: string, sessionId: string) => {
      if (sessionId === "s1") {
        return { ok: true, messages: [] };
      }

      if (sessionId === "s2") {
        return { ok: true, messages: [] };
      }

      return { ok: true, messages: [] };
    });

    const streamClosers: Array<() => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/u/alice/agents") {
        return {
          ok: true,
          json: async () => ({
            agents: [
              {
                id: "assistant",
                displayName: "Assistant",
                model: "openai/gpt-5.4",
                isPrimary: true,
              },
            ],
          }),
        };
      }

      if (String(input) === "/api/u/alice/providers") {
        return {
          ok: true,
          json: async () => ({ providers: [] }),
        };
      }

      if (String(input) === "/api/w/alice/chat/stream") {
        let closeStream = () => {};
        const streamDone = new Promise<void>((resolve) => {
          closeStream = resolve;
        });
        streamClosers.push(closeStream);

        return {
          ok: true,
          body: {
            getReader() {
              return {
                read: async () => {
                  await streamDone;
                  return { done: true, value: undefined };
                },
              };
            },
          },
        };
      }

      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
    });

    let firstSendPromise: Promise<boolean> | undefined;
    await act(async () => {
      firstSendPromise = result.current.sendMessage("first");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isSending).toBe(true);
      expect(result.current.messages.some((message) => message.content === "first")).toBe(true);
    });

    act(() => {
      result.current.selectSession("s2");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s2");
      expect(result.current.isSending).toBe(false);
    });

    let secondSendPromise: Promise<boolean> | undefined;
    await act(async () => {
      secondSendPromise = result.current.sendMessage("second");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isSending).toBe(true);
      expect(result.current.messages.some((message) => message.content === "second")).toBe(true);
    });

    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/w/alice/chat/stream")
    ).toHaveLength(2);

    streamClosers.forEach((closeStream) => closeStream());

    await act(async () => {
      await Promise.all([firstSendPromise, secondSendPromise]);
    });
  });
});
