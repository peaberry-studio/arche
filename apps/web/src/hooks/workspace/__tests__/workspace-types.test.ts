import { describe, expect, it } from "vitest";

import {
  applyDeltaToPart,
  areMessageListsEqual,
  areMessagesEqual,
  areModelsEqual,
  arePartsEqual,
  areStatusInfoEqual,
  areWorkspaceSessionListsEqual,
  collectSessionFamilyIds,
  createDefaultSessionSelectionState,
  extractPartDeltaText,
  filterModelsByProviderStatus,
  findAgentInCatalog,
  getPrimaryAgent,
  getSessionSelectionKey,
  getString,
  hasModelEntry,
  mergeWorkspaceSessions,
  normalizeAgentId,
  parseModelString,
  removeWorkspaceSessions,
  resolveModelEntry,
  toPermissionPart,
} from "@/hooks/workspace/workspace-types";
import type { AvailableModel, WorkspaceMessage, WorkspaceSession } from "@/lib/opencode/types";

function session(
  id: string,
  options: Partial<WorkspaceSession> = {}
): WorkspaceSession {
  return {
    id,
    title: id,
    status: "idle",
    updatedAt: "now",
    ...options,
  };
}

function message(options: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    id: "message-1",
    sessionId: "session-1",
    role: "assistant",
    content: "Hello",
    timestamp: "now",
    timestampRaw: 1,
    parts: [{ type: "text", text: "Hello" }],
    ...options,
  };
}

const models: AvailableModel[] = [
  {
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-4.1",
    modelName: "GPT 4.1",
    isDefault: true,
  },
  {
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-sonnet",
    modelName: "Claude Sonnet",
    isDefault: false,
  },
  {
    providerId: "opencode",
    providerName: "OpenCode",
    modelId: "zen",
    modelName: "Zen",
    isDefault: false,
  },
  {
    providerId: "custom-provider",
    providerName: "Custom",
    modelId: "custom-model",
    modelName: "Custom Model",
    isDefault: false,
  },
];

describe("workspace-types session helpers", () => {
  it("removes sessions by id", () => {
    expect(
      removeWorkspaceSessions(
        [session("root"), session("child", { parentId: "root" })],
        new Set(["child"])
      )
    ).toEqual([session("root")]);
  });

  it("collects transitive session family ids", () => {
    expect(
      [...collectSessionFamilyIds(
        [
          session("root"),
          session("child", { parentId: "root" }),
          session("grandchild", { parentId: "child" }),
          session("sibling"),
        ],
        "root"
      )].sort()
    ).toEqual(["child", "grandchild", "root"]);
  });

  it("compares message fields, models, statuses, and parts", () => {
    const base = message({
      agentId: "agent-1",
      model: { providerId: "openai", modelId: "gpt-4.1" },
      pending: true,
      statusInfo: { status: "tool-calling", toolName: "Read", detail: "file.ts" },
    });

    expect(areModelsEqual(base.model, { providerId: "openai", modelId: "gpt-4.1" })).toBe(true);
    expect(areModelsEqual(base.model, { providerId: "openai", modelId: "gpt-4o" })).toBe(false);
    expect(areStatusInfoEqual(base.statusInfo, { status: "tool-calling", toolName: "Read", detail: "file.ts" })).toBe(true);
    expect(areStatusInfoEqual(base.statusInfo, { status: "error", detail: "file.ts" })).toBe(false);
    expect(arePartsEqual(base.parts, [{ type: "text", text: "Hello" }])).toBe(true);
    expect(arePartsEqual(base.parts, [{ type: "text", text: "Different" }])).toBe(false);
    expect(areMessagesEqual(base, { ...base })).toBe(true);
    expect(areMessagesEqual(base, { ...base, content: "Different" })).toBe(false);
    expect(areMessageListsEqual([base], [{ ...base }])).toBe(true);
    expect(areMessageListsEqual([base], [])).toBe(false);
  });

  it("normalizes stream deltas and permission parts", () => {
    expect(extractPartDeltaText("hello")).toBe("hello");
    expect(extractPartDeltaText({ text: "hello" })).toBe("hello");
    expect(extractPartDeltaText({ text: 1 })).toBeNull();
    expect(extractPartDeltaText(null)).toBeNull();
    expect(getString(" value ")).toBe("value");
    expect(getString("   ")).toBeUndefined();

    expect(toPermissionPart(null)).toBeNull();
    expect(toPermissionPart({ id: "perm-1" })).toBeNull();
    expect(toPermissionPart({
      callId: "call-1",
      id: "perm-1",
      metadata: { reason: "needs approval" },
      pattern: "Bash(*)",
      sessionId: "session-1",
      state: "approved",
      title: "Approve command",
      type: "tool",
    })).toEqual({
      callId: "call-1",
      id: "permission:perm-1",
      metadata: { reason: "needs approval" },
      pattern: "Bash(*)",
      permissionId: "perm-1",
      permissionType: "tool",
      sessionId: "session-1",
      state: "approved",
      title: "Approve command",
      type: "permission",
    });
    expect(toPermissionPart({ id: "perm-2", pattern: "Edit(*)", sessionId: "session-1" })).toMatchObject({
      state: "pending",
      title: "Edit(*)",
    });
  });

  it("applies text deltas to streaming parts", () => {
    const accumulator = new Map<string, string>();

    expect(applyDeltaToPart("message-1", "raw", "ignored", accumulator)).toBe("raw");
    expect(applyDeltaToPart("message-1", { type: "file", path: "a.md" }, "ignored", accumulator)).toEqual({
      type: "file",
      path: "a.md",
    });
    expect(applyDeltaToPart("message-1", { type: "text", id: "part-1", text: "" }, "Hel", accumulator)).toEqual({
      type: "text",
      id: "part-1",
      text: "Hel",
    });
    expect(applyDeltaToPart("message-1", { type: "text", id: "part-1", text: "" }, { text: "lo" }, accumulator)).toEqual({
      type: "text",
      id: "part-1",
      text: "Hello",
    });
    expect(applyDeltaToPart("message-2", { type: "reasoning", text: "Seed" }, "ignored", accumulator)).toEqual({
      type: "reasoning",
      id: "reasoning:message-2",
      text: "Seed",
    });
    expect(applyDeltaToPart("message-3", { type: "text", text: "" }, null, accumulator)).toEqual({
      type: "text",
      id: "text:message-3",
      text: "",
    });
  });

  it("filters models and resolves catalog selections", () => {
    expect(filterModelsByProviderStatus(models, [{ providerId: "openai", status: "enabled" }])).toEqual([
      models[0],
      models[2],
      models[3],
    ]);
    expect(parseModelString("openai/gpt-4.1")).toEqual({ providerId: "openai", modelId: "gpt-4.1" });
    expect(parseModelString("openai/")).toBeNull();
    expect(resolveModelEntry("openai", "gpt-4.1", models)).toBe(models[0]);
    expect(resolveModelEntry("missing", "model", models)).toEqual({
      providerId: "missing",
      providerName: "missing",
      modelId: "model",
      modelName: "model",
      isDefault: false,
    });
    expect(hasModelEntry("openai", "gpt-4.1", models)).toBe(true);
    expect(hasModelEntry("openai", "missing", models)).toBe(false);

    const catalog = [
      { id: "primary", displayName: "Primary Agent", isPrimary: true },
      { id: "helper", displayName: "Helper Agent", isPrimary: false },
    ];
    expect(normalizeAgentId(" Helper Agent ")).toBe("helper agent");
    expect(findAgentInCatalog(catalog, "helper")).toBe(catalog[1]);
    expect(findAgentInCatalog(catalog, "helper agent")).toBe(catalog[1]);
    expect(getPrimaryAgent(catalog)).toBe(catalog[0]);
    expect(getPrimaryAgent([])).toBeNull();
  });

  it("handles session selection and merging helpers", () => {
    expect(getSessionSelectionKey(null)).toBe("__pre_session__");
    expect(getSessionSelectionKey("session-1")).toBe("session-1");
    expect(createDefaultSessionSelectionState("primary")).toEqual({
      activeAgentId: "primary",
      manualModel: null,
      runtimeModel: null,
    });

    expect(mergeWorkspaceSessions(
      [session("root"), session("child")],
      [session("child"), session("other")],
    )).toEqual([session("root"), session("child"), session("other")]);

    expect(areWorkspaceSessionListsEqual(
      [session("root", { autopilot: { runId: "run-1", taskId: "task-1", taskName: "Task", trigger: "schedule", hasUnseenResult: true } })],
      [session("root", { autopilot: { runId: "run-1", taskId: "task-1", taskName: "Task", trigger: "schedule", hasUnseenResult: true } })],
    )).toBe(true);
    expect(areWorkspaceSessionListsEqual([session("root")], [session("root", { title: "renamed" })])).toBe(false);
  });
});
