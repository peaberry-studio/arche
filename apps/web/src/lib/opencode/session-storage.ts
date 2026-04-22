import { existsSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "path";

import { getArcheOpencodeDataDir } from "@/lib/runtime/desktop/workspace-dirs";
import { execInContainer } from "@/lib/spawner/docker";

export type StoredWorkspaceSession = {
  id: string;
  parentId?: string;
  title: string;
  updatedAtRaw?: number;
};

export type StoredWorkspaceSessionCursor = {
  id: string;
  updatedAt: number;
};

export type StoredWorkspaceSessionPage = {
  hasMore: boolean;
  nextCursor: StoredWorkspaceSessionCursor | null;
  sessions: StoredWorkspaceSession[];
};

export type StoredWorkspaceSessionFamily = {
  rootSessionId: string | null;
  sessions: StoredWorkspaceSession[];
};

type SessionStoragePageQuery = {
  cursor?: StoredWorkspaceSessionCursor | null;
  limit?: number;
  mode: "page";
  projectId: string;
  rootsOnly?: boolean;
};

type SessionStorageFamilyQuery = {
  mode: "family";
  projectId: string;
  sessionId: string;
};

type SessionStorageQuery = SessionStoragePageQuery | SessionStorageFamilyQuery;

type SessionStorageRow = {
  id: string;
  parent_id: string | null;
  time_updated: number | null;
  title: string;
};

const OPENCODE_SESSION_DB_FILENAME = "opencode.db";
const OPENCODE_SESSION_DB_CONTAINER_PATH = "/home/workspace/.local/share/opencode/opencode.db";
const SESSION_DB_QUERY_TIMEOUT_MS = 30_000;
const MAX_LIMIT = 1000;

const SQL_PAGE_BASE = [
  "SELECT id, parent_id, title, time_updated",
  "FROM session",
  "WHERE {whereClause}",
  "ORDER BY time_updated DESC, id DESC",
  "LIMIT ?",
].join(" ");

const SQL_FAMILY_TARGET =
  "SELECT id, parent_id FROM session WHERE id = ? AND project_id = ? LIMIT 1";

const SQL_FAMILY_ANCESTORS = [
  "WITH RECURSIVE ancestry(id, parent_id) AS (",
  "  SELECT id, parent_id FROM session WHERE id = ? AND project_id = ?",
  "  UNION ALL",
  "  SELECT session.id, session.parent_id",
  "  FROM session",
  "  JOIN ancestry ON session.id = ancestry.parent_id",
  "  WHERE session.project_id = ?",
  ")",
  "SELECT id, parent_id FROM ancestry",
].join(" ");

const SQL_FAMILY_DESCENDANTS = [
  "WITH RECURSIVE family(id, parent_id, title, time_updated) AS (",
  "  SELECT id, parent_id, title, time_updated",
  "  FROM session",
  "  WHERE id = ? AND project_id = ?",
  "  UNION ALL",
  "  SELECT session.id, session.parent_id, session.title, session.time_updated",
  "  FROM session",
  "  JOIN family ON session.parent_id = family.id",
  "  WHERE session.project_id = ?",
  ")",
  "SELECT id, parent_id, title, time_updated FROM family",
  "ORDER BY time_updated DESC, id DESC",
].join(" ");

function mapSessionRow(row: SessionStorageRow): StoredWorkspaceSession {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    updatedAtRaw: typeof row.time_updated === "number" ? row.time_updated : undefined,
  };
}

function createNextCursor(row: SessionStorageRow | undefined, hasMore: boolean): StoredWorkspaceSessionCursor | null {
  if (!hasMore || !row || typeof row.time_updated !== "number") {
    return null;
  }

  return { id: row.id, updatedAt: row.time_updated };
}

function classifySessionStorageFailure(detail?: string): "session_storage_missing" | "session_storage_query_failed" {
  const normalized = detail?.toLowerCase() ?? "";
  if (
    normalized.includes("enoent") ||
    normalized.includes("no such file") ||
    normalized.includes("sqlite_cantopen")
  ) {
    return "session_storage_missing";
  }

  return "session_storage_query_failed";
}

function createSessionStorageError(detail?: string): Error {
  return new Error(classifySessionStorageFailure(detail));
}

function getDesktopSessionDatabasePath(): string {
  return join(getArcheOpencodeDataDir(), OPENCODE_SESSION_DB_FILENAME);
}

// Query SQLite inside the workspace container so we read the live WAL-backed DB
// without depending on OpenCode's hardcoded /session limit.
const SESSION_DB_SCRIPT = String.raw`
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = '${OPENCODE_SESSION_DB_CONTAINER_PATH}';
const encodedInput = process.argv.at(-1);
if (!encodedInput) {
  throw new Error('missing_session_storage_input');
}

const input = JSON.parse(Buffer.from(encodedInput, 'base64').toString('utf8'));
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const mapSession = (row) => ({
  id: row.id,
  parentId: row.parent_id ?? undefined,
  title: row.title,
  updatedAtRaw: typeof row.time_updated === 'number' ? row.time_updated : undefined,
});

const MAX_LIMIT = ${MAX_LIMIT};
const SQL_PAGE_BASE = ${JSON.stringify(SQL_PAGE_BASE)};
const SQL_FAMILY_TARGET = ${JSON.stringify(SQL_FAMILY_TARGET)};
const SQL_FAMILY_ANCESTORS = ${JSON.stringify(SQL_FAMILY_ANCESTORS)};
const SQL_FAMILY_DESCENDANTS = ${JSON.stringify(SQL_FAMILY_DESCENDANTS)};

try {
  if (input.mode === 'page') {
    const where = ['project_id = ?'];
    const params = [input.projectId];

    if (input.rootsOnly) {
      where.push('parent_id IS NULL');
    }

    if (input.cursor) {
      where.push('(time_updated < ? OR (time_updated = ? AND id < ?))');
      params.push(input.cursor.updatedAt, input.cursor.updatedAt, input.cursor.id);
    }

    const limit = Math.max(1, Math.min(Number(input.limit ?? 100), MAX_LIMIT));
    const sql = SQL_PAGE_BASE.replace('{whereClause}', where.join(' AND '));
    const rows = db.prepare(sql).all(...params, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    console.log(
      JSON.stringify({
        hasMore,
        nextCursor: hasMore && lastRow && typeof lastRow.time_updated === 'number'
          ? { id: lastRow.id, updatedAt: lastRow.time_updated }
          : null,
        sessions: pageRows.map(mapSession),
      }),
    );
    process.exit(0);
  }

  if (input.mode === 'family') {
    const target = db.prepare(SQL_FAMILY_TARGET).get(input.sessionId, input.projectId);

    if (!target) {
      console.log(JSON.stringify({ rootSessionId: null, sessions: [] }));
      process.exit(0);
    }

    const ancestors = db.prepare(SQL_FAMILY_ANCESTORS).all(input.sessionId, input.projectId, input.projectId);

    const root = ancestors.find((row) => !row.parent_id) ?? ancestors.at(-1) ?? target;
    const familyRows = db.prepare(SQL_FAMILY_DESCENDANTS).all(root.id, input.projectId, input.projectId);

    console.log(
      JSON.stringify({
        rootSessionId: root.id,
        sessions: familyRows.map(mapSession),
      }),
    );
    process.exit(0);
  }

  throw new Error('unsupported_session_storage_mode');
} finally {
db.close();
}
`;

function queryStoredWorkspaceSessionsPage(
  db: DatabaseSync,
  input: SessionStoragePageQuery,
): StoredWorkspaceSessionPage {
  const where = ["project_id = ?"];
  const params: Array<string | number> = [input.projectId];

  if (input.rootsOnly) {
    where.push("parent_id IS NULL");
  }

  if (input.cursor) {
    where.push("(time_updated < ? OR (time_updated = ? AND id < ?))");
    params.push(input.cursor.updatedAt, input.cursor.updatedAt, input.cursor.id);
  }

  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), MAX_LIMIT));
  const sql = SQL_PAGE_BASE.replace("{whereClause}", where.join(" AND "));
  const rows = db
    .prepare(sql)
    .all(...params, limit + 1) as SessionStorageRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    hasMore,
    nextCursor: createNextCursor(pageRows.at(-1), hasMore),
    sessions: pageRows.map(mapSessionRow),
  };
}

function queryStoredWorkspaceSessionFamily(
  db: DatabaseSync,
  input: SessionStorageFamilyQuery,
): StoredWorkspaceSessionFamily {
  const target = db
    .prepare(SQL_FAMILY_TARGET)
    .get(input.sessionId, input.projectId) as { id: string; parent_id: string | null } | undefined;

  if (!target) {
    return { rootSessionId: null, sessions: [] };
  }

  const ancestors = db
    .prepare(SQL_FAMILY_ANCESTORS)
    .all(input.sessionId, input.projectId, input.projectId) as Array<{ id: string; parent_id: string | null }>;

  const root = ancestors.find((row) => !row.parent_id) ?? ancestors.at(-1) ?? target;
  const familyRows = db
    .prepare(SQL_FAMILY_DESCENDANTS)
    .all(root.id, input.projectId, input.projectId) as SessionStorageRow[];

  return {
    rootSessionId: root.id,
    sessions: familyRows.map(mapSessionRow),
  };
}

function runLocalSessionStorageQuery<T>(input: SessionStorageQuery): T {
  const dbPath = getDesktopSessionDatabasePath();
  if (!existsSync(dbPath)) {
    throw createSessionStorageError("ENOENT");
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    if (input.mode === "page") {
      return queryStoredWorkspaceSessionsPage(db, input) as T;
    }

    return queryStoredWorkspaceSessionFamily(db, input) as T;
  } catch (error) {
    throw createSessionStorageError(error instanceof Error ? error.message : String(error));
  } finally {
    db.close();
  }
}

async function runSessionStorageQuery<T>(
  containerId: string,
  input: Record<string, unknown>,
): Promise<T> {
  const encodedInput = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
  const result = await execInContainer(
    containerId,
    ["node", "--input-type=module", "-e", SESSION_DB_SCRIPT, encodedInput],
    { timeout: SESSION_DB_QUERY_TIMEOUT_MS },
  );

  if (result.exitCode !== 0) {
    throw createSessionStorageError(result.stderr.trim());
  }

  return JSON.parse(result.stdout) as T;
}

export function listStoredWorkspaceSessionsPage(input: {
  containerId: string | null;
  cursor?: StoredWorkspaceSessionCursor | null;
  limit: number;
  projectId: string;
  rootsOnly?: boolean;
}): Promise<StoredWorkspaceSessionPage> {
  const query: SessionStoragePageQuery = {
    cursor: input.cursor ?? null,
    limit: input.limit,
    mode: "page",
    projectId: input.projectId,
    rootsOnly: input.rootsOnly ?? false,
  };

  if (!input.containerId) {
    return Promise.resolve(runLocalSessionStorageQuery<StoredWorkspaceSessionPage>(query));
  }

  return runSessionStorageQuery<StoredWorkspaceSessionPage>(input.containerId, query);
}

export function listStoredWorkspaceSessionFamily(input: {
  containerId: string | null;
  projectId: string;
  sessionId: string;
}): Promise<StoredWorkspaceSessionFamily> {
  const query: SessionStorageFamilyQuery = {
    mode: "family",
    projectId: input.projectId,
    sessionId: input.sessionId,
  };

  if (!input.containerId) {
    return Promise.resolve(runLocalSessionStorageQuery<StoredWorkspaceSessionFamily>(query));
  }

  return runSessionStorageQuery<StoredWorkspaceSessionFamily>(input.containerId, query);
}
