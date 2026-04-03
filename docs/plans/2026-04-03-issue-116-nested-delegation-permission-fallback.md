# Issue 116 Nested Delegation Permission Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent raw nested-delegation permission failures from reaching users while preserving the current business rule that subagent-to-subagent delegation is not supported.

**Architecture:** Introduce one shared classifier/sanitizer for the known `task` permission failure, then use it at both delivery boundaries: the SSE bridge (`chat/stream`) and the persisted-message transformation path (`listMessagesAction` via `transformParts`). The matcher must stay narrow and only match the concrete nested-delegation permission signature from issue `#116`. In the stream path we sanitize the tool part before both `sendEvent("part")` and `emitStatus(...)`, suppress the terminal `session.error`, and keep the stream alive so the assistant can continue. In the persisted-message path we drop that internal tool failure before the UI ever sees it, so neither streamed nor refreshed messages can render the raw rules list.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, React 19, Vitest 3, pnpm 10

### Task 1: Add a shared nested-delegation error classifier

**Files:**
- Create: `apps/web/src/lib/workspace-runtime-errors.ts`
- Create: `apps/web/src/lib/__tests__/workspace-runtime-errors.test.ts`

**Step 1: Write the failing tests**

Add tests for a helper module that:
- recognizes the known nested-delegation permission failure only when the message matches the concrete signature from issue `#116`,
- requires the raw permission-rules payload shape (`The user has specified a rule...`) plus `task`-specific allow/deny details for `session.error`,
- requires `toolName === "task"` and `input.subagent_type` when sanitizing tool-part failures,
- does **not** match unrelated permission failures (`bash`, `edit`, generic forbidden, arbitrary `task denied` without the issue signature),
- returns a sanitized tool-state shape for the known `task` failure that should be hidden from users,
- returns a `shouldSuppressSessionError`-style result for the same known failure.

Suggested test cases:

```ts
it("matches the raw task permission rules payload from issue 116", () => {
  expect(isNestedTaskDelegationPermissionError(RAW_ISSUE_116_ERROR)).toBe(true);
});

it("does not match arbitrary task failures without the issue 116 signature", () => {
  expect(isNestedTaskDelegationPermissionError("tool 'task' denied")).toBe(false);
});

it("does not match unrelated permission failures", () => {
  expect(isNestedTaskDelegationPermissionError("tool 'bash' denied")).toBe(false);
});

it("coerces nested task permission failures into a silent completed tool state", () => {
  expect(
    sanitizeTaskToolFailure({
      toolName: "task",
      status: "error",
      input: { subagent_type: "seo" },
      error: RAW_ISSUE_116_ERROR,
    }),
  ).toEqual({
    status: "completed",
    input: { subagent_type: "seo" },
    output: "",
    title: "Delegation returned to the main assistant",
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
cd apps/web && pnpm test -- src/lib/__tests__/workspace-runtime-errors.test.ts
```

Expected: FAIL because the helper module does not exist yet.

**Step 3: Write the minimal implementation**

Create `workspace-runtime-errors.ts` with small, explicit helpers:

```ts
type RawToolFailure = {
  toolName: string;
  status: "error" | "running" | "pending" | "completed";
  input: Record<string, unknown>;
  error?: string;
  title?: string;
  output?: string;
};

export function isNestedTaskDelegationPermissionError(message: string): boolean;

export function shouldSuppressWorkspaceSessionError(message: string): boolean;

export function sanitizeWorkspaceToolFailure(
  failure: RawToolFailure,
): RawToolFailure | {
  toolName: string;
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  title: string;
};
```

Implementation rules:
- Match only the concrete nested-delegation `task` permission signature from issue `#116`.
- Prefer explicit string predicates over fuzzy regex soup.
- Keep the helper dependency-free so both the route and transform layer can import it.
- Use one canonical sanitized title string, for example `Delegation returned to the main assistant`.

**Step 4: Run the test to verify it passes**

Run:

```bash
cd apps/web && pnpm test -- src/lib/__tests__/workspace-runtime-errors.test.ts
```

Expected: PASS

### Task 2: Suppress and log the runtime error in the SSE bridge

**Files:**
- Modify: `apps/web/src/app/api/w/[slug]/chat/stream/route.ts`
- Test: `apps/web/tests/chat-stream-attachments.test.ts`

**Step 1: Write the failing integration tests**

Add tests covering both stream-time surfaces for the known failure:

1. `session.error` carries the raw `task` permission message, followed by continued assistant output and idle completion.
2. `message.part.updated` contains a `tool` part named `task` with `state.status === "error"` and the same raw error.

Assertions:
- the SSE response does **not** contain the raw rules list,
- the SSE response does **not** emit `status: error` for this case,
- the SSE response does **not** emit `event: error` for this case,
- the SSE response still emits later assistant parts and `event: done`,
- the route logs the suppression server-side (stub `console.warn` or `console.info` if practical).

Suggested skeleton:

```ts
expect(sseOutput).not.toContain('event: error');
expect(sseOutput).not.toContain('"status":"error"');
expect(sseOutput).not.toContain('The user has specified a rule');
expect(sseOutput).toContain('event: part');
expect(sseOutput).toContain('event: done');
```

**Step 2: Run the targeted test to verify it fails**

Run:

```bash
cd apps/web && pnpm test -- tests/chat-stream-attachments.test.ts
```

Expected: FAIL because the route currently forwards `session.error` and raw tool-part errors verbatim.

**Step 3: Implement the minimal route changes**

In `route.ts`:
- import the new helper(s),
- before forwarding a `session.error`, detect the known nested-delegation permission failure,
- if it matches:
  - log with structured server-side context (`slug`, `sessionId`, event type, tool name when known),
  - do **not** call `emitStatus("error", ...)`,
  - do **not** call `sendEvent("error", ...)`,
  - do **not** set `aborted = true`,
  - continue reading the stream,
- before forwarding a `message.part.updated` tool part, sanitize the `task` tool failure payload so the client never receives the raw permission string,
- compute `emitStatus(...)` from the sanitized part, not the raw part, so this path also avoids `status: error`.

Suggested implementation shape:

```ts
if (eventType === "session.error") {
  const errorMessage = error?.data?.message || "Unknown error";
  if (shouldSuppressWorkspaceSessionError(errorMessage)) {
    console.warn("[chat-stream] Suppressed nested task delegation permission error", {
      slug,
      sessionId,
      errorMessage,
    });
    break;
  }
}

const sanitizedPart = sanitizeStreamingPart(part);
sendEvent("part", { messageId: partMessageId, part: sanitizedPart, delta });
updateStatusFromPart(sanitizedPart);
```

**Step 4: Run the targeted test to verify it passes**

Run:

```bash
cd apps/web && pnpm test -- tests/chat-stream-attachments.test.ts
```

Expected: PASS

### Task 3: Sanitize persisted messages so refresh/resume paths stay clean

**Files:**
- Modify: `apps/web/src/lib/opencode/transform.ts`
- Create: `apps/web/src/lib/opencode/__tests__/transform.test.ts`
- Modify: `apps/web/src/hooks/__tests__/use-workspace-streaming.test.tsx`
- Optionally modify: `apps/web/src/components/workspace/__tests__/chat-panel.test.tsx`

**Step 1: Write the failing regression tests**

Add tests that prove the sanitized behavior survives reconciliation:

1. `transformParts()` drops the raw `task` tool permission failure from persisted parts entirely.
2. `transformParts()` never returns the raw rules-list string in `part.state.error`.
3. Existing generic error handling still works for unrelated backend failures.
4. If the known `session.error` is suppressed but no coherent recovery happens afterwards, the stream still falls back to the normal terminal path (`stream_incomplete` or equivalent), rather than silently succeeding.

**Step 2: Run the targeted tests to verify they fail**

Run:

```bash
cd apps/web && pnpm test -- src/lib/opencode/__tests__/transform.test.ts tests/chat-stream-attachments.test.ts
```

Expected: FAIL because the refresh path still rebuilds raw tool error parts from persisted runtime messages and the stream path still treats the nested-delegation failure as terminal.

**Step 3: Implement the minimal transformation changes**

In `transform.ts`:
- reuse the shared helper when mapping `tool` parts,
- if the raw part is a `task` permission-denied nested-delegation failure, drop it so persisted-message refreshes do not re-expose the internal failure and empty assistant responses still resolve through the normal `stream_incomplete` path.

In `chat-panel.test.tsx` (optional but recommended defense-in-depth):
- add a regression that proves the raw issue `#116` error text is absent from rendered delegation UI when fed the sanitized post-transform part.

**Step 4: Run the targeted tests to verify they pass**

Run:

```bash
cd apps/web && pnpm test -- src/lib/opencode/__tests__/transform.test.ts src/lib/__tests__/workspace-runtime-errors.test.ts tests/chat-stream-attachments.test.ts src/components/workspace/__tests__/chat-panel.test.tsx
```

Expected: PASS

### Task 4: End-to-end verification, lint, and security review

**Files:**
- Review only: `apps/web/src/app/api/w/[slug]/chat/stream/route.ts`
- Review only: `apps/web/src/lib/opencode/transform.ts`
- Review only: `apps/web/src/lib/workspace-runtime-errors.ts`
- Review only: `apps/web/src/hooks/use-workspace.ts`

**Step 1: Run the focused verification suite**

Run:

```bash
cd apps/web && pnpm test -- tests/chat-stream-attachments.test.ts src/lib/__tests__/workspace-runtime-errors.test.ts src/lib/opencode/__tests__/transform.test.ts src/hooks/__tests__/use-workspace-streaming.test.tsx src/components/workspace/__tests__/chat-panel.test.tsx
```

Expected: PASS

**Step 2: Run the full required project checks**

Run:

```bash
cd apps/web && pnpm test
cd apps/web && pnpm lint
```

Expected: PASS

**Step 3: Perform the security audit**

Audit checklist:
- Confirm raw runtime permission payloads are no longer exposed to the browser.
- Confirm logs remain server-side only.
- Confirm we are not suppressing unrelated authorization failures.
- Confirm no user-controlled data is interpolated into logs in a way that changes behavior.
- Confirm the suppression logic is narrowly scoped to the known `task` nested-delegation pattern.

**Step 4: Commit**

Run:

```bash
git add \
  docs/plans/2026-04-03-issue-116-nested-delegation-permission-fallback.md \
  apps/web/src/lib/workspace-runtime-errors.ts \
  apps/web/src/lib/__tests__/workspace-runtime-errors.test.ts \
  apps/web/src/app/api/w/[slug]/chat/stream/route.ts \
  apps/web/tests/chat-stream-attachments.test.ts \
  apps/web/src/lib/opencode/transform.ts \
  apps/web/src/lib/opencode/__tests__/transform.test.ts \
  apps/web/src/components/workspace/chat-panel/messages.tsx \
  apps/web/src/components/workspace/__tests__/chat-panel.test.tsx

git commit -m "fix(workspace): silence nested delegation permission errors"
```

Expected: commit created on `fix/116-subagent-task-permission-fallback`

### Task 5: Publish and open the PR

**Files:**
- No code changes

**Step 1: Push the branch**

Run:

```bash
git push -u origin fix/116-subagent-task-permission-fallback
```

Expected: branch published to `origin`

**Step 2: Open the PR**

Create a ready-for-review PR against `main` with:
- Title: `fix(workspace): silence nested delegation permission errors`
- Reviewer: `Iñaki Tajes`
- Body sections:
  - what changed,
  - why the issue happened,
  - why we kept nested delegation blocked in this fix,
  - how it was verified.

**Step 3: Final manual review checklist**

- Reproduce the original issue flow mentally against the final code path.
- Confirm the user never sees the raw rules list in streamed or refreshed messages.
- Confirm unrelated stream errors still surface normally.
- Confirm the diff stays tightly scoped to issue `#116`.
