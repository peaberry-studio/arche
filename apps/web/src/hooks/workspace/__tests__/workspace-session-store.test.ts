/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import {
  collectLoadedFamilyIds,
  createSessionStore,
  deriveVisibleSessions,
  getActiveSessionStorageKey,
  hasSession,
  loadStoredActiveSessionId,
  mergeSessionFamily,
  persistActiveSessionId,
  prependSession,
  readStoredValue,
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

function makeStorage(initial: Record<string, string> = {}): Storage {
  const store: Record<string, string | null> = { ...initial };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }),
    key: vi.fn(),
    length: Object.keys(store).length,
  } as unknown as Storage;
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

  describe("getActiveSessionStorageKey", () => {
    it("prefixes the scope", () => {
      expect(getActiveSessionStorageKey("alice")).toBe(
        "arche.workspace.alice.active-session"
      );
    });
  });

  describe("readStoredValue", () => {
    it("returns trimmed non-empty values", () => {
      const storage = makeStorage({ foo: "bar" });
      expect(readStoredValue(storage, "foo")).toBe("bar");
    });

    it("returns null for missing keys", () => {
      const storage = makeStorage();
      expect(readStoredValue(storage, "foo")).toBeNull();
    });

    it("returns null for blank values", () => {
      const storage = makeStorage({ foo: "   " });
      expect(readStoredValue(storage, "foo")).toBeNull();
    });
  });

  describe("loadStoredActiveSessionId", () => {
    it("reads from sessionStorage first", () => {
      const session = makeStorage({ key: "from-session" });
      const local = makeStorage({ key: "from-local" });
      vi.stubGlobal("sessionStorage", session);
      vi.stubGlobal("localStorage", local);

      expect(loadStoredActiveSessionId("key")).toBe("from-session");

      vi.unstubAllGlobals();
    });

    it("falls back to localStorage when sessionStorage is empty", () => {
      const session = makeStorage({ key: null as unknown as string });
      const local = makeStorage({ key: "from-local" });
      vi.stubGlobal("sessionStorage", session);
      vi.stubGlobal("localStorage", local);

      expect(loadStoredActiveSessionId("key")).toBe("from-local");

      vi.unstubAllGlobals();
    });

    it("returns null when both are empty", () => {
      vi.stubGlobal("sessionStorage", makeStorage());
      vi.stubGlobal("localStorage", makeStorage());

      expect(loadStoredActiveSessionId("key")).toBeNull();

      vi.unstubAllGlobals();
    });

    it("returns null when storage throws", () => {
      vi.stubGlobal("sessionStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage);
      vi.stubGlobal("localStorage", makeStorage());

      expect(loadStoredActiveSessionId("key")).toBeNull();

      vi.unstubAllGlobals();
    });
  });

  describe("persistActiveSessionId", () => {
    it("writes to both storages", () => {
      const session = makeStorage();
      const local = makeStorage();
      vi.stubGlobal("sessionStorage", session);
      vi.stubGlobal("localStorage", local);

      persistActiveSessionId("key", "s1");

      expect(session.getItem("key")).toBe("s1");
      expect(local.getItem("key")).toBe("s1");

      vi.unstubAllGlobals();
    });

    it("removes from both storages when null", () => {
      const session = makeStorage({ key: "s1" });
      const local = makeStorage({ key: "s1" });
      vi.stubGlobal("sessionStorage", session);
      vi.stubGlobal("localStorage", local);

      persistActiveSessionId("key", null);

      expect(session.getItem("key")).toBeNull();
      expect(local.getItem("key")).toBeNull();

      vi.unstubAllGlobals();
    });

    it("ignores storage errors", () => {
      vi.stubGlobal("sessionStorage", {
        setItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage);
      vi.stubGlobal("localStorage", makeStorage());

      expect(() => persistActiveSessionId("key", "s1")).not.toThrow();

      vi.unstubAllGlobals();
    });
  });
});
