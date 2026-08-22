/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  collectLoadedFamilyIds,
  createSessionStore,
  deriveVisibleSessions,
  hasSession,
  mergeSessionFamily,
  prependSession,
  removeSessionFamily,
  replaceRootSessions,
  updateSessionById,
} from "@/hooks/workspace/workspace-session-store";
import type { WorkspaceSession } from "@/lib/opencode/types";

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

describe("workspace-session-store", () => {
  it("creates an empty normalized store", () => {
    const store = createSessionStore();

    expect(store.sessionsById).toEqual({});
    expect(store.visibleOrder).toEqual([]);
    expect(store.rootOrder).toEqual([]);
    expect(store.loadedFamilyRootId).toBeNull();
    expect([...store.loadedFamilySessionIds]).toEqual([]);
  });

  it("replaces root sessions while preserving a loaded family", () => {
    const withFamily = mergeSessionFamily(createSessionStore(), "root", [
      session("root"),
      session("child", { parentId: "root" }),
    ]);

    const store = replaceRootSessions(withFamily, [session("new-root")]);

    expect(deriveVisibleSessions(store).map((item) => item.id)).toEqual([
      "new-root",
      "root",
      "child",
    ]);
  });

  it("merges a session family without duplicating root ids", () => {
    const roots = replaceRootSessions(createSessionStore(), [session("root")]);
    const store = mergeSessionFamily(roots, "root", [
      session("root", { title: "Updated" }),
      session("child", { parentId: "root" }),
    ]);

    expect(store.rootOrder).toEqual(["root"]);
    expect(store.loadedFamilyRootId).toBe("root");
    expect([...store.loadedFamilySessionIds]).toEqual(["root", "child"]);
    expect(deriveVisibleSessions(store).map((item) => item.id)).toEqual([
      "root",
      "child",
    ]);
    expect(store.sessionsById.root?.title).toBe("Updated");
  });

  it("prepends a new session and marks its family loaded", () => {
    const roots = replaceRootSessions(createSessionStore(), [session("old")]);
    const store = prependSession(roots, session("new"));

    expect(store.rootOrder).toEqual(["new", "old"]);
    expect(store.loadedFamilyRootId).toBe("new");
    expect([...store.loadedFamilySessionIds]).toEqual(["new"]);
  });

  it("updates sessions by id", () => {
    const roots = replaceRootSessions(createSessionStore(), [session("s1")]);
    const store = updateSessionById(roots, "s1", (current) => ({
      ...current,
      title: "Renamed",
    }));

    expect(store.sessionsById.s1?.title).toBe("Renamed");
  });

  it("collects and removes a loaded session family", () => {
    const store = mergeSessionFamily(createSessionStore(), "root", [
      session("root"),
      session("child", { parentId: "root" }),
      session("grandchild", { parentId: "child" }),
      session("other"),
    ]);

    expect([...collectLoadedFamilyIds(store, "child")]).toEqual([
      "child",
      "grandchild",
    ]);

    const next = removeSessionFamily(store, "child");

    expect(hasSession(next, "root")).toBe(true);
    expect(hasSession(next, "child")).toBe(false);
    expect(hasSession(next, "grandchild")).toBe(false);
  });
});
