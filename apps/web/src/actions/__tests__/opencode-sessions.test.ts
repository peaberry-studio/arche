import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/runtime/capabilities", () => ({
  getRuntimeCapabilities: vi.fn(),
}));

vi.mock("@/lib/opencode/client", () => ({
  createInstanceClient: vi.fn(),
  getInstanceUrl: vi.fn(),
}));

vi.mock("@/lib/opencode/session-storage", () => ({
  listStoredWorkspaceSessionFamily: vi.fn(),
  listStoredWorkspaceSessionsPage: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  autopilotService: {
    findSessionMetadataByUserId: vi.fn(),
  },
  instanceService: {
    findBySlug: vi.fn(),
  },
  userService: {
    findIdBySlug: vi.fn(),
  },
}));

import { getSession } from "@/lib/runtime/session";
import { getRuntimeCapabilities } from "@/lib/runtime/capabilities";
import { createInstanceClient } from "@/lib/opencode/client";
import {
  listStoredWorkspaceSessionFamily,
  listStoredWorkspaceSessionsPage,
} from "@/lib/opencode/session-storage";
import { autopilotService, instanceService } from "@/lib/services";
import {
  listSessionFamilyAction,
  listSessionsAction,
} from "../opencode";

const mockGetSession = vi.mocked(getSession);
const mockGetRuntimeCapabilities = vi.mocked(getRuntimeCapabilities);
const mockCreateInstanceClient = vi.mocked(createInstanceClient);
const mockListStoredWorkspaceSessionsPage = vi.mocked(listStoredWorkspaceSessionsPage);
const mockListStoredWorkspaceSessionFamily = vi.mocked(listStoredWorkspaceSessionFamily);
const mockFindSessionMetadataByUserId = vi.mocked(autopilotService.findSessionMetadataByUserId);
const mockFindInstanceBySlug = vi.mocked(instanceService.findBySlug);

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

  mockGetRuntimeCapabilities.mockReturnValue({
    multiUser: true,
    auth: true,
    containers: true,
    workspaceAgent: true,
    reaper: true,
    csrf: true,
    twoFactor: true,
    teamManagement: true,
    connectors: true,
    kickstart: true,
    autopilot: true,
    slackIntegration: true,
  });

  mockCreateInstanceClient.mockResolvedValue({
    project: {
      current: vi.fn().mockResolvedValue({ data: { id: "project-1" } }),
    },
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: { root: { type: "busy" } } }),
    },
  } as never);

  mockFindInstanceBySlug.mockResolvedValue({
    id: "instance-1",
    slug: "alice",
    status: "running",
    createdAt: new Date(),
    startedAt: new Date(),
    stoppedAt: null,
    lastActivityAt: new Date(),
    containerId: "container-1",
    serverPassword: "encrypted",
    appliedConfigSha: null,
    providerSyncHash: null,
    providerSyncedAt: null,
  });

  mockFindSessionMetadataByUserId.mockResolvedValue([
    {
      openCodeSessionId: "root",
      trigger: "schedule",
      taskId: "task-1",
      taskName: "Daily brief",
      runId: "run-1",
      hasUnseenResult: true,
    },
  ]);
});

describe("session listing actions", () => {
  it("lists a paginated root page from storage with cursor metadata", async () => {
    mockListStoredWorkspaceSessionsPage.mockResolvedValue({
      hasMore: true,
      nextCursor: { id: "root", updatedAt: 200 },
      sessions: [
        {
          id: "root",
          title: "Daily brief",
          updatedAtRaw: 200,
        },
      ],
    });

    const result = await listSessionsAction("alice", {
      limit: 1,
      rootsOnly: true,
    });

    expect(mockListStoredWorkspaceSessionsPage).toHaveBeenCalledWith({
      containerId: "container-1",
      cursor: undefined,
      limit: 1,
      projectId: "project-1",
      rootsOnly: true,
    });
    expect(result).toEqual({
      ok: true,
      hasMore: true,
      nextCursor: { id: "root", updatedAt: 200 },
      sessions: [
        expect.objectContaining({
          id: "root",
          title: "Daily brief",
          status: "busy",
          updatedAtRaw: 200,
          autopilot: expect.objectContaining({
            runId: "run-1",
            taskName: "Daily brief",
            hasUnseenResult: true,
          }),
        }),
      ],
    });
  });

  it("loads the active family from storage", async () => {
    mockListStoredWorkspaceSessionFamily.mockResolvedValue({
      rootSessionId: "root",
      sessions: [
        {
          id: "child",
          parentId: "root",
          title: "Child session",
          updatedAtRaw: 150,
        },
        {
          id: "root",
          title: "Root session",
          updatedAtRaw: 200,
        },
      ],
    });

    const result = await listSessionFamilyAction("alice", "child");

    expect(mockListStoredWorkspaceSessionFamily).toHaveBeenCalledWith({
      containerId: "container-1",
      projectId: "project-1",
      sessionId: "child",
    });
    expect(result).toEqual({
      ok: true,
      rootSessionId: "root",
      sessions: [
        expect.objectContaining({ id: "child", parentId: "root", title: "Child session" }),
        expect.objectContaining({ id: "root", parentId: undefined, title: "Root session" }),
      ],
    });
  });

  it("uses local session storage when containers are unavailable", async () => {
    mockGetRuntimeCapabilities.mockReturnValue({
      multiUser: false,
      auth: false,
      containers: false,
      workspaceAgent: true,
      reaper: false,
      csrf: false,
      twoFactor: false,
      teamManagement: false,
      connectors: true,
      kickstart: true,
      autopilot: false,
      slackIntegration: false,
    });
    mockFindInstanceBySlug.mockResolvedValue({
      id: "instance-1",
      slug: "alice",
      status: "running",
      createdAt: new Date(),
      startedAt: new Date(),
      stoppedAt: null,
      lastActivityAt: new Date(),
      containerId: null,
      serverPassword: "encrypted",
      appliedConfigSha: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    });
    mockListStoredWorkspaceSessionsPage.mockResolvedValue({
      hasMore: false,
      nextCursor: null,
      sessions: [{ id: "desktop-root", title: "Desktop root", updatedAtRaw: 50 }],
    });

    const result = await listSessionsAction("alice", { rootsOnly: true });

    expect(mockListStoredWorkspaceSessionsPage).toHaveBeenCalledWith({
      containerId: null,
      cursor: undefined,
      limit: 100,
      projectId: "project-1",
      rootsOnly: true,
    });
    expect(result.ok).toBe(true);
    expect(result.sessions).toEqual([
      expect.objectContaining({ id: "desktop-root", title: "Desktop root" }),
    ]);
  });
});
