import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/opencode/client", () => ({
  createInstanceClient: vi.fn(),
  getInstanceUrl: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  flowService: {
    findSessionMetadataForWorkspace: vi.fn(),
  },
  userService: {
    findIdBySlug: vi.fn(),
  },
}));

import { getSession } from "@/lib/runtime/session";
import { createInstanceClient } from "@/lib/opencode/client";
import { flowService } from "@/lib/services";
import {
  listSessionFamilyAction,
  listSessionsAction,
} from "../opencode";

const mockGetSession = vi.mocked(getSession);
const mockCreateInstanceClient = vi.mocked(createInstanceClient);
const mockFindSessionMetadataForWorkspace = vi.mocked(flowService.findSessionMetadataForWorkspace);
const mockSessionList = vi.fn();
const mockSessionStatus = vi.fn();
const mockSessionGet = vi.fn();
const mockSessionChildren = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  mockGetSession.mockResolvedValue({
    user: {
      id: "user-1",
      email: "alice@test.com",
      slug: "alice",
      role: "USER",
    },
    sessionId: "sess-1",
  });

  mockCreateInstanceClient.mockResolvedValue({
    session: {
      children: mockSessionChildren,
      get: mockSessionGet,
      list: mockSessionList,
      status: mockSessionStatus,
    },
  } as never);

  mockSessionList.mockResolvedValue({ data: [] });
  mockSessionStatus.mockResolvedValue({ data: { root: { type: "busy" } } });
  mockSessionGet.mockResolvedValue({ data: null });
  mockSessionChildren.mockResolvedValue({ data: [] });

  mockFindSessionMetadataForWorkspace.mockResolvedValue([
    {
      openCodeSessionId: "root",
      trigger: "schedule",
      flowId: "flow-1",
      flowName: "Daily brief",
      runId: "run-1",
      status: "succeeded",
      hasUnseenResult: true,
    },
  ]);
});

describe("session listing actions", () => {
  it("lists root sessions from the OpenCode API with optimistic hasMore metadata", async () => {
    mockSessionList.mockResolvedValue({
      data: [
        {
          id: "root",
          parentID: undefined,
          share: { url: "https://share.test/root" },
          time: { created: 100, updated: 200 },
          title: "Daily brief",
          version: "1",
        },
      ],
    });

    const result = await listSessionsAction("alice", {
      limit: 1,
      rootsOnly: true,
    });

    expect(mockSessionList).toHaveBeenCalledWith({
      limit: 1,
      roots: true,
      start: undefined,
    });
    expect(result).toEqual({
      ok: true,
      hasMore: true,
      sessions: [
        expect.objectContaining({
          id: "root",
          share: { url: "https://share.test/root", version: 1 },
          title: "Daily brief",
          status: "busy",
          updatedAtRaw: 200,
          flow: expect.objectContaining({
            runId: "run-1",
            flowName: "Daily brief",
            hasUnseenResult: true,
          }),
        }),
      ],
    });
  });

  it("loads the active family from the OpenCode API", async () => {
    mockSessionGet
      .mockResolvedValueOnce({
        data: {
          id: "child",
          parentID: "root",
          time: { created: 120, updated: 150 },
          title: "Child session",
          version: "1",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "root",
          parentID: undefined,
          time: { created: 100, updated: 200 },
          title: "Root session",
          version: "1",
        },
      });
    mockSessionChildren.mockResolvedValueOnce({
      data: [
        {
          id: "child",
          parentID: "root",
          time: { created: 120, updated: 150 },
          title: "Child session",
          version: "1",
        },
      ],
    });

    const result = await listSessionFamilyAction("alice", "child");

    expect(mockSessionGet).toHaveBeenNthCalledWith(1, { sessionID: "child" });
    expect(mockSessionGet).toHaveBeenNthCalledWith(2, { sessionID: "root" });
    expect(mockSessionChildren).toHaveBeenCalledWith({ sessionID: "root" });
    expect(result).toEqual({
      ok: true,
      rootSessionId: "root",
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: "child", parentId: "root", title: "Child session" }),
        expect.objectContaining({ id: "root", parentId: undefined, title: "Root session" }),
      ]),
    });
  });

  it("passes the optional start timestamp through to the OpenCode API", async () => {
    mockSessionList.mockResolvedValue({
      data: [
        {
          id: "desktop-root",
          parentID: undefined,
          time: { created: 25, updated: 50 },
          title: "Desktop root",
          version: "1",
        },
      ],
    });

    const result = await listSessionsAction("alice", {
      rootsOnly: true,
      start: 25,
    });

    expect(mockSessionList).toHaveBeenCalledWith({
      limit: undefined,
      roots: true,
      start: 25,
    });
    expect(result.ok).toBe(true);
    expect(result.sessions).toEqual([
      expect.objectContaining({ id: "desktop-root", title: "Desktop root" }),
    ]);
  });

  it("hides learning sessions from the main session list", async () => {
    mockSessionList.mockResolvedValue({
      data: [
        {
          id: "chat",
          parentID: undefined,
          time: { created: 25, updated: 50 },
          title: "Regular chat",
          version: "1",
        },
        {
          id: "learning",
          parentID: undefined,
          time: { created: 26, updated: 51 },
          title: "Learning | Regular chat",
          version: "1",
        },
        {
          id: "flow-learning",
          parentID: undefined,
          time: { created: 27, updated: 52 },
          title: "Flow | Learning | Weekly review",
          version: "1",
        },
      ],
    });

    const result = await listSessionsAction("alice", { rootsOnly: true });

    expect(result.sessions).toEqual([
      expect.objectContaining({ id: "chat", title: "Regular chat" }),
    ]);
  });

  it("searches up to 100 recent root sessions by title and task name", async () => {
    mockSessionList.mockResolvedValue({
      data: [
        {
          id: "root",
          parentID: undefined,
          time: { created: 100, updated: 200 },
          title: "Unrelated title",
          version: "1",
        },
        {
          id: "manual",
          parentID: undefined,
          time: { created: 120, updated: 220 },
          title: "Daily chat",
          version: "1",
        },
      ],
    });

    const result = await listSessionsAction("alice", {
      limit: 500,
      query: "daily",
      rootsOnly: true,
    });

    expect(mockSessionList).toHaveBeenCalledWith({
      limit: 100,
      roots: true,
      start: undefined,
    });
    expect(result).toEqual({
      ok: true,
      hasMore: false,
      sessions: [
        expect.objectContaining({ id: "root", flow: expect.objectContaining({ flowName: "Daily brief" }) }),
        expect.objectContaining({ id: "manual", title: "Daily chat" }),
      ],
    });
  });
});
