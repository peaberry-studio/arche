/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listModelsAction } from "@/actions/opencode";
import { useWorkspaceModelSelection } from "@/hooks/workspace/use-workspace-model-selection";
import type { WorkspaceMessage } from "@/lib/opencode/types";

const opencodeMocks = vi.hoisted(() => ({
  listModelsAction: vi.fn(),
}));

vi.mock("@/actions/opencode", () => opencodeMocks);

const assistantMessage: WorkspaceMessage = {
  id: "m1",
  sessionId: "s1",
  role: "assistant",
  content: "done",
  timestamp: "now",
  parts: [{ type: "agent", id: "agent-part", name: "Reviewer" }],
  pending: false,
  model: { providerId: "openai", modelId: "gpt-5.2" },
};

describe("useWorkspaceModelSelection", () => {
  beforeEach(() => {
    vi.mocked(listModelsAction).mockResolvedValue({
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/u/alice/providers") {
          return {
            ok: true,
            json: async () => ({ providers: [{ providerId: "openai", status: "enabled" }] }),
          };
        }

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
                {
                  id: "reviewer",
                  displayName: "Reviewer",
                  model: "openai/gpt-5.2",
                  isPrimary: false,
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
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("memoizes the primary agent default model from the loaded catalog", async () => {
    const { result } = renderHook(() =>
      useWorkspaceModelSelection({ slug: "alice", getActiveSessionId: () => "s1" })
    );

    await act(async () => {
      await result.current.loadModels();
      await result.current.loadAgentCatalog();
    });

    await waitFor(() => {
      expect(result.current.agentDefaultModel?.modelId).toBe("gpt-5.4");
    });

    const previousDefault = result.current.agentDefaultModel;

    act(() => {
      result.current.setSelectedModel(result.current.models[0]);
    });

    expect(result.current.agentDefaultModel).toBe(previousDefault);
  });

  it("syncs runtime model and active agent from hydrated messages", async () => {
    const { result } = renderHook(() =>
      useWorkspaceModelSelection({ slug: "alice", getActiveSessionId: () => "s1" })
    );

    await act(async () => {
      await result.current.loadModels();
      await result.current.loadAgentCatalog();
    });

    act(() => {
      result.current.syncRuntimeMetadataForSession("s1", [assistantMessage]);
    });

    expect(result.current.sessionSelectionState.s1).toMatchObject({
      activeAgentId: "reviewer",
      runtimeModel: { providerId: "openai", modelId: "gpt-5.2" },
    });
  });
});
