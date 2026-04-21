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

const SESSION_DB_QUERY_TIMEOUT_MS = 30_000;

// Query SQLite inside the workspace container so we read the live WAL-backed DB
// without depending on OpenCode's hardcoded /session limit.
const SESSION_DB_SCRIPT = String.raw`
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = '/home/workspace/.local/share/opencode/opencode.db';
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

const MAX_LIMIT = 1000;

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
    const rows = db
      .prepare(
        [
          'SELECT id, parent_id, title, time_updated',
          'FROM session',
          'WHERE ' + where.join(' AND '),
          'ORDER BY time_updated DESC, id DESC',
          'LIMIT ?',
        ].join(' '),
      )
      .all(...params, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    console.log(
      JSON.stringify({
        hasMore,
        nextCursor: hasMore && lastRow
          ? { id: lastRow.id, updatedAt: lastRow.time_updated }
          : null,
        sessions: pageRows.map(mapSession),
      }),
    );
    process.exit(0);
  }

  if (input.mode === 'family') {
    const target = db
      .prepare('SELECT id, parent_id FROM session WHERE id = ? AND project_id = ? LIMIT 1')
      .get(input.sessionId, input.projectId);

    if (!target) {
      console.log(JSON.stringify({ rootSessionId: null, sessions: [] }));
      process.exit(0);
    }

    const ancestors = db
      .prepare(
        [
          'WITH RECURSIVE ancestry(id, parent_id) AS (',
          '  SELECT id, parent_id FROM session WHERE id = ? AND project_id = ?',
          '  UNION ALL',
          '  SELECT session.id, session.parent_id',
          '  FROM session',
          '  JOIN ancestry ON session.id = ancestry.parent_id',
          '  WHERE session.project_id = ?',
          ')',
          'SELECT id, parent_id FROM ancestry',
        ].join(' '),
      )
      .all(input.sessionId, input.projectId, input.projectId);

    const root = ancestors.find((row) => !row.parent_id) ?? ancestors.at(-1) ?? target;
    const familyRows = db
      .prepare(
        [
          'WITH RECURSIVE family(id, parent_id, title, time_updated) AS (',
          '  SELECT id, parent_id, title, time_updated',
          '  FROM session',
          '  WHERE id = ? AND project_id = ?',
          '  UNION ALL',
          '  SELECT session.id, session.parent_id, session.title, session.time_updated',
          '  FROM session',
          '  JOIN family ON session.parent_id = family.id',
          '  WHERE session.project_id = ?',
          ')',
          'SELECT id, parent_id, title, time_updated FROM family',
          'ORDER BY time_updated DESC, id DESC',
        ].join(' '),
      )
      .all(root.id, input.projectId, input.projectId);

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
    throw new Error(result.stderr.trim() || `session_storage_query_failed:${result.exitCode}`);
  }

  return JSON.parse(result.stdout) as T;
}

export function listStoredWorkspaceSessionsPage(input: {
  containerId: string;
  cursor?: StoredWorkspaceSessionCursor | null;
  limit: number;
  projectId: string;
  rootsOnly?: boolean;
}): Promise<StoredWorkspaceSessionPage> {
  return runSessionStorageQuery<StoredWorkspaceSessionPage>(input.containerId, {
    cursor: input.cursor ?? null,
    limit: input.limit,
    mode: "page",
    projectId: input.projectId,
    rootsOnly: input.rootsOnly ?? false,
  });
}

export function listStoredWorkspaceSessionFamily(input: {
  containerId: string;
  projectId: string;
  sessionId: string;
}): Promise<StoredWorkspaceSessionFamily> {
  return runSessionStorageQuery<StoredWorkspaceSessionFamily>(input.containerId, {
    mode: "family",
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
}
