/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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

function createStorageMock() {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

function createPendingStreamBody() {
  let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | null = null;
  let closed = false;

  return {
    body: {
      getReader() {
        return {
          read: () =>
            new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
              if (closed) {
                resolve({ done: true, value: undefined });
                return;
              }
              resolveRead = resolve;
            }),
        };
      },
    },
    close() {
      closed = true;
      resolveRead?.({ done: true, value: undefined });
    },
  };
}

describe("useWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    localStorage.clear();
    sessionStorage.clear();
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

        if (String(input) === "/api/u/alice/providers") {
          return {
            ok: true,
            json: async () => ({
              providers: [{ providerId: "openai", status: "enabled" }],
            }),
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );
  });

  afterEach(() => {
    cleanup();
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

  it("sends the primary agent model when there is no manual selection", async () => {
    let requestBody:
      | {
          model?: { providerId: string; modelId: string };
        }
      | null = null;

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

        if (String(input) === "/api/u/alice/providers") {
          return {
            ok: true,
            json: async () => ({
              providers: [{ providerId: "openai", status: "enabled" }],
            }),
          };
        }

        if (String(input) === "/api/w/alice/chat/stream") {
          requestBody = JSON.parse(String(init?.body ?? "{}")) as {
            model?: { providerId: string; modelId: string };
          };

          return {
            ok: true,
            body: {
              getReader() {
                return {
                  read: async () => ({ done: true, value: undefined }),
                };
              },
            },
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
      expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
    });

    await act(async () => {
      await result.current.createSession("Fresh");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s2");
      expect(result.current.hasManualModelSelection).toBe(false);
    });

    let accepted = false;
    await act(async () => {
      accepted = await result.current.sendMessage("Use default model");
    });

    expect(accepted).toBe(true);

    await waitFor(() => {
      expect(requestBody).not.toBeNull();
    });

    expect(requestBody?.model).toEqual({
      providerId: "openai",
      modelId: "gpt-5.4",
    });
  });

  it("keeps opencode models available when provider credentials are missing", async () => {
    opencodeMocks.listModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: "opencode",
          providerName: "OpenCode",
          modelId: "free-model",
          modelName: "Free model",
          isDefault: true,
        },
      ],
    });

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
                  model: "opencode/free-model",
                  isPrimary: true,
                },
              ],
            }),
          };
        }

        if (String(input) === "/api/u/alice/providers") {
          return {
            ok: true,
            json: async () => ({
              providers: [{ providerId: "opencode", status: "missing" }],
            }),
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.models).toHaveLength(1);
      expect(result.current.models[0]?.providerId).toBe("opencode");
      expect(result.current.agentDefaultModel?.providerId).toBe("opencode");
    });
  });

  it("resolves aliased fireworks agent defaults to runtime provider ids", async () => {
    opencodeMocks.listModelsAction.mockResolvedValue({
      ok: true,
      models: [
        {
          providerId: "fireworks-ai",
          providerName: "Fireworks AI",
          modelId: "accounts/fireworks/models/glm-5",
          modelName: "GLM-5",
          isDefault: true,
        },
      ],
    });

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
                  model: "fireworks/accounts/fireworks/models/glm-5",
                  isPrimary: true,
                },
              ],
            }),
          };
        }

        if (String(input) === "/api/u/alice/providers") {
          return {
            ok: true,
            json: async () => ({
              providers: [{ providerId: "fireworks", status: "enabled" }],
            }),
          };
        }

        throw new Error(`Unexpected fetch: ${String(input)}`);
      })
    );

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.agentDefaultModel?.providerId).toBe("fireworks-ai");
    });

    await act(async () => {
      await result.current.createSession("Fresh");
    });

    await waitFor(() => {
      expect(result.current.selectedModel?.providerId).toBe("fireworks-ai");
      expect(result.current.selectedModel?.modelId).toBe(
        "accounts/fireworks/models/glm-5"
      );
    });
  });

  it("keeps the requested manual title when the OpenCode update response is stale", async () => {
    opencodeMocks.listSessionsAction.mockReset();
    opencodeMocks.listSessionsAction
      .mockResolvedValueOnce({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "now" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        sessions: [{ id: "s1", title: "Release plan", status: "idle", updatedAt: "later" }],
      });

    opencodeMocks.updateSessionAction.mockResolvedValue({
      ok: true,
      session: { id: "s1", title: "Existing", status: "idle", updatedAt: "later" },
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.sessions[0]?.title).toBe("Existing");
    });

    await act(async () => {
      await result.current.renameSession("s1", "Release plan");
    });

    await waitFor(() => {
      expect(result.current.sessions[0]?.title).toBe("Release plan");
    });
  });

  it("ignores stale session loads that started before a rename mutation", async () => {
    let resolveStaleSessions:
      | ((value: { ok: boolean; sessions: Array<{ id: string; title: string; status: string; updatedAt: string }> }) => void)
      | null = null;

    opencodeMocks.listSessionsAction.mockReset();
    opencodeMocks.listSessionsAction
      .mockResolvedValueOnce({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "now" }],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleSessions = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        sessions: [{ id: "s1", title: "Release plan", status: "idle", updatedAt: "fresh" }],
      });

    opencodeMocks.updateSessionAction.mockResolvedValue({
      ok: true,
      session: { id: "s1", title: "Release plan", status: "idle", updatedAt: "fresh" },
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 1000 })
    );

    await waitFor(() => {
      expect(result.current.sessions[0]?.title).toBe("Existing");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    await waitFor(() => {
      expect(opencodeMocks.listSessionsAction).toHaveBeenCalledTimes(2);
    }, { timeout: 2000 });

    await act(async () => {
      await result.current.renameSession("s1", "Release plan");
    });

    await waitFor(() => {
      expect(opencodeMocks.listSessionsAction).toHaveBeenCalledTimes(3);
      expect(result.current.sessions[0]?.title).toBe("Release plan");
    }, { timeout: 2000 });

    await act(async () => {
      resolveStaleSessions?.({
        ok: true,
        sessions: [{ id: "s1", title: "Existing", status: "idle", updatedAt: "stale" }],
      });
      await Promise.resolve();
    });

    expect(result.current.sessions[0]?.title).toBe("Release plan");
  });

  it("keeps manual model selection scoped to each session", async () => {
    opencodeMocks.listSessionsAction.mockResolvedValue({
      ok: true,
      sessions: [
        { id: "s1", title: "First", status: "idle", updatedAt: "now" },
        { id: "s2", title: "Second", status: "idle", updatedAt: "now" },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
      expect(result.current.selectedModel?.modelId).toBe("gpt-5.2");
    });

    act(() => {
      result.current.setSelectedModel({
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5.4",
        modelName: "GPT 5.4",
        isDefault: false,
      });
    });

    expect(result.current.selectedModel?.modelId).toBe("gpt-5.4");
    expect(result.current.hasManualModelSelection).toBe(true);

    act(() => {
      result.current.selectSession("s2");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s2");
      expect(result.current.selectedModel?.modelId).toBe("gpt-5.4");
      expect(result.current.hasManualModelSelection).toBe(false);
    });

    act(() => {
      result.current.selectSession("s1");
    });

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
      expect(result.current.selectedModel?.modelId).toBe("gpt-5.4");
      expect(result.current.hasManualModelSelection).toBe(true);
    });
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
    opencodeMocks.listModelsAction
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue({
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

    const { result, rerender } = renderHook(
      ({ enabled }) => useWorkspace({ slug: "alice", pollInterval: 0, enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
    });

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

    rerender({ enabled: false });
    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.hasManualModelSelection).toBe(false);
    });

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
      expect(result.current.isSending).toBe(false);
    });

    await act(async () => {
      await result.current.refreshMessages();
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

  it("resolves sendMessage before the stream finishes so the composer can clear immediately", async () => {
    const stream = createPendingStreamBody();

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

        if (String(input) === "/api/w/alice/chat/stream") {
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
      expect(result.current.activeSessionId).toBe("s1");
    });

    let accepted = false;
    await act(async () => {
      accepted = await result.current.sendMessage("clear now");
    });

    expect(accepted).toBe(true);
    expect(result.current.isSending).toBe(true);

    act(() => {
      stream.close();
    });
  });

  it("aborts the active stream and clears pending assistant state", async () => {
    const stream = createPendingStreamBody();

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

        if (String(input) === "/api/w/alice/chat/stream") {
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
      expect(result.current.activeSessionId).toBe("s1");
    });

    await act(async () => {
      await result.current.sendMessage("cancel me");
    });

    await waitFor(() => {
      expect(result.current.isSending).toBe(true);
    });

    await act(async () => {
      await result.current.abortSession();
    });

    expect(opencodeMocks.abortSessionAction).toHaveBeenCalledWith("alice", "s1");
    expect(result.current.isSending).toBe(false);
    expect(result.current.messages.at(-1)?.pending).toBe(false);
    expect(result.current.messages.at(-1)?.statusInfo).toEqual({
      status: "error",
      detail: "cancelled",
    });

    act(() => {
      stream.close();
    });
  });

  describe("idle polling optimization", () => {
    it("does not poll diffs when all sessions are idle", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "idle", updatedAt: "now" },
        ],
      });

      const { result } = renderHook(() =>
        useWorkspace({ slug: "alice", pollInterval: 200 })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.activeSessionId).toBe("s1");
      });

      opencodeMocks.getWorkspaceDiffsAction.mockClear();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(opencodeMocks.getWorkspaceDiffsAction).not.toHaveBeenCalled();
    });

    it("does not poll messages for the active session when it is idle", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "idle", updatedAt: "now" },
        ],
      });

      const { result } = renderHook(() =>
        useWorkspace({ slug: "alice", pollInterval: 200 })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.activeSessionId).toBe("s1");
      });

      opencodeMocks.listMessagesAction.mockClear();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(opencodeMocks.listMessagesAction).not.toHaveBeenCalled();
    });

    it("polls diffs and messages when a session is busy", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "busy", updatedAt: "now" },
        ],
      });

      const { result } = renderHook(() =>
        useWorkspace({ slug: "alice", pollInterval: 200 })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.activeSessionId).toBe("s1");
      });

      opencodeMocks.getWorkspaceDiffsAction.mockClear();
      opencodeMocks.listMessagesAction.mockClear();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalled();
      expect(opencodeMocks.listMessagesAction).toHaveBeenCalledWith("alice", "s1");
    });

    it("polls messages only for busy sessions, not the idle active session", async () => {
      opencodeMocks.listSessionsAction.mockResolvedValue({
        ok: true,
        sessions: [
          { id: "s1", title: "First", status: "idle", updatedAt: "now" },
          { id: "s2", title: "Second", status: "busy", updatedAt: "now" },
        ],
      });

      const { result } = renderHook(() =>
        useWorkspace({ slug: "alice", pollInterval: 200 })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.activeSessionId).toBe("s1");
      });

      opencodeMocks.getWorkspaceDiffsAction.mockClear();
      opencodeMocks.listMessagesAction.mockClear();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      // Diffs should be polled because s2 is busy
      expect(opencodeMocks.getWorkspaceDiffsAction).toHaveBeenCalled();
      // Messages for s2 (busy) should be polled
      expect(opencodeMocks.listMessagesAction).toHaveBeenCalledWith("alice", "s2");
      // Messages for s1 (idle active) should NOT be polled
      const s1Calls = opencodeMocks.listMessagesAction.mock.calls.filter(
        ([, sessionId]: [string, string]) => sessionId === "s1"
      );
      expect(s1Calls).toHaveLength(0);
    });
  });

  it("preserves the active message list reference when refresh returns identical messages", async () => {
    const { result } = renderHook(() =>
      useWorkspace({ slug: "alice", pollInterval: 0 })
    );

    await waitFor(() => {
      expect(result.current.activeSessionId).toBe("s1");
      expect(result.current.messages).toHaveLength(1);
    });

    const initialMessages = result.current.messages;

    await act(async () => {
      await result.current.refreshMessages();
    });

    expect(result.current.messages).toBe(initialMessages);
  });
});
