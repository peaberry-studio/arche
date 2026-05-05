/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanelMessages } from "@/components/workspace/chat-panel/messages";
import type { MessagePart } from "@/lib/opencode/types";
import type { ChatMessage } from "@/types/workspace";

vi.mock("next/image", () => ({
  default: () => null,
}));

function renderMessages(props?: Partial<Parameters<typeof ChatPanelMessages>[0]>) {
  const onOpenFile = vi.fn();
  const onSelectSessionTab = vi.fn();
  const onScrollContainer = vi.fn();

  const view = render(
    <ChatPanelMessages
      chatContentStyle={{ height: 400 }}
      connectorNamesById={{ "conn-1": "Linear" }}
      isStartingNewSession={false}
      messages={[]}
      messagesEndRef={createRef<HTMLDivElement>()}
      onOpenFile={onOpenFile}
      onScrollContainer={onScrollContainer}
      onSelectSessionTab={onSelectSessionTab}
      scrollContainerRef={createRef<HTMLDivElement>()}
      sessionTabs={[{ id: "root", title: "Main", status: "idle", depth: 0 }, { id: "sub", title: "Reviewer task", status: "busy", depth: 1 }]}
      workspaceRoot="/workspace/project"
      {...props}
    />
  );

  return { ...view, onOpenFile, onSelectSessionTab, onScrollContainer };
}

function assistantMessage(parts: MessagePart[], overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: "a1",
    sessionId: "s1",
    role: "assistant",
    content: "",
    timestamp: "10:00",
    timestampRaw: Date.UTC(2026, 0, 1, 10, 0),
    parts,
    ...overrides,
  };
}

describe("ChatPanelMessages", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders the empty and starting states", () => {
    const { rerender } = render(
      <ChatPanelMessages
        chatContentStyle={{}}
        connectorNamesById={{}}
        isStartingNewSession={false}
        messages={[]}
        messagesEndRef={createRef<HTMLDivElement>()}
        onOpenFile={() => {}}
        onScrollContainer={() => {}}
        scrollContainerRef={createRef<HTMLDivElement>()}
        sessionTabs={[]}
      />
    );

    expect(screen.getByText("Start a new conversation")).toBeTruthy();

    rerender(
      <ChatPanelMessages
        chatContentStyle={{}}
        connectorNamesById={{}}
        isStartingNewSession={true}
        messages={[]}
        messagesEndRef={createRef<HTMLDivElement>()}
        onOpenFile={() => {}}
        onScrollContainer={() => {}}
        scrollContainerRef={createRef<HTMLDivElement>()}
        sessionTabs={[]}
      />
    );

    expect(screen.getByText("Starting a new conversation...")).toBeTruthy();
  });

  it("renders rich assistant parts, grouped files, tool summaries, and message actions", async () => {
    const parts: MessagePart[] = [
      { type: "text", id: "text-1", text: "Here is the answer" },
      { type: "reasoning", id: "reasoning-1", text: "Thinking through the answer" },
      {
        type: "tool",
        id: "read-1",
        name: "read",
        state: { status: "completed", input: { filePath: "/workspace/project/src/app.ts", offset: 2, limit: 5 }, output: "", title: "Read file" },
      },
      {
        type: "tool",
        id: "grep-1",
        name: "grep",
        state: { status: "completed", input: { pattern: "TODO", include: "*.ts", path: "/workspace/project/src" }, output: "", title: "Search" },
      },
      {
        type: "tool",
        id: "bash-1",
        name: "bash",
        state: { status: "running", input: { description: "Run tests", command: "pnpm test" }, title: "Run tests" },
      },
      {
        type: "tool",
        id: "task-1",
        name: "task",
        state: { status: "running", input: { subagent_type: "reviewer", description: "Review code" }, title: "Delegate" },
      },
      {
        type: "tool",
        id: "todo-1",
        name: "todowrite",
        state: {
          status: "completed",
          input: { todos: [{ content: "Draft", status: "completed" }, { title: "Review", status: "in_progress" }] },
          output: "",
          title: "Plan",
        },
      },
      {
        type: "tool",
        id: "email-1",
        name: "email_draft",
        state: {
          status: "completed",
          input: {},
          output: JSON.stringify({ subject: "Hello", body: "Email body", to: ["ana@example.com"] }),
          title: "Draft email",
        },
      },
      { type: "file", id: "file-1", path: "notes/report.md", filename: "report.md" },
      { type: "file", id: "file-2", path: "notes/brief.md", filename: "brief.md" },
      { type: "image", id: "image-1", url: "data:image/png;base64,abc" },
      { type: "patch", id: "patch-1", files: ["a.ts", "b.ts"] },
      { type: "agent", id: "agent-1", name: "assistant" },
      { type: "subtask", id: "subtask-1", prompt: "Review", description: "Review code", agent: "researcher" },
      { type: "retry", id: "retry-1", attempt: 2, error: "rate_limited" },
      { type: "unknown", originalType: "custom", data: { value: 1 } },
      { type: "step-finish", id: "finish-1", reason: "done", cost: 0.01, tokens: { input: 1200, output: 300 } },
    ];
    const { onOpenFile, onSelectSessionTab } = renderMessages({
      messages: [assistantMessage(parts, { pending: true })],
    });

    expect(screen.getByText("Here is the answer")).toBeTruthy();
    expect(screen.queryByText("Thinking through the answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(screen.getByText("Thinking through the answer")).toBeTruthy();
    expect(screen.getByText("Reading file")).toBeTruthy();
    expect(screen.getByText(/src\/app\.ts/)).toBeTruthy();
    expect(screen.getByText(/pattern=TODO/)).toBeTruthy();
    expect(screen.getByText("Run tests")).toBeTruthy();
    expect(screen.getByText("Delegated to Reviewer")).toBeTruthy();
    expect(screen.getByText("1/2 done · 1 in progress")).toBeTruthy();
    expect(screen.getByText("Email draft")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("2 files")).toBeTruthy();
    expect(screen.getByText("Changes in 2 files")).toBeTruthy();
    expect(screen.getByText("Agent: assistant")).toBeTruthy();
    expect(screen.getByText("Subtask -> researcher")).toBeTruthy();
    expect(screen.getByText("Retrying (attempt 2)...")).toBeTruthy();
    expect(screen.getByText("Unknown type: custom")).toBeTruthy();

    fireEvent.click(screen.getAllByText("Open")[0]);
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");

    fireEvent.click(screen.getByRole("button", { name: /brief.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith("notes/brief.md");

    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    expect(onSelectSessionTab).toHaveBeenCalledWith("sub");

    fireEvent.click(screen.getByLabelText("Copy email draft"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Subject: Hello")));
  });

  it("opens the exact subagent session for each task delegation", () => {
    const { onSelectSessionTab } = renderMessages({
      sessionTabs: [
        { id: "root", title: "Main", status: "idle", depth: 0 },
        { id: "sub-latest", title: "Second review (@reviewer subagent)", status: "idle", depth: 1 },
        { id: "sub-first", title: "First review (@reviewer subagent)", status: "idle", depth: 1 },
      ],
      messages: [
        assistantMessage([
          {
            type: "tool",
            id: "task-first",
            name: "task",
            state: {
              status: "completed",
              input: { subagent_type: "reviewer", description: "First review" },
              output: "task_id: sub-first (for resuming to continue this task if needed)\n\n<task_result>ok</task_result>",
              title: "First review",
            },
          },
          {
            type: "tool",
            id: "task-latest",
            name: "task",
            state: {
              status: "completed",
              input: { subagent_type: "reviewer", description: "Second review" },
              output: "task_id: sub-latest (for resuming to continue this task if needed)\n\n<task_result>ok</task_result>",
              title: "Second review",
            },
          },
        ]),
      ],
    });

    const viewButtons = screen.getAllByRole("button", { name: /View/ });

    fireEvent.click(viewButtons[0]);
    expect(onSelectSessionTab).toHaveBeenLastCalledWith("sub-first");

    fireEvent.click(viewButtons[1]);
    expect(onSelectSessionTab).toHaveBeenLastCalledWith("sub-latest");
  });

  it("renders user and assistant attachments, error notices, and fallback copy", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {} });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    const { onOpenFile, onScrollContainer } = renderMessages({
      messages: [
        {
          id: "u1",
          sessionId: "s1",
          role: "user",
          content: "Please read this",
          timestamp: "10:00",
          timestampRaw: Date.UTC(2026, 0, 1, 10, 0),
          attachments: [{ type: "file", label: "input.pdf", path: "attachments/input.pdf" }],
        },
        assistantMessage([], {
          id: "a2",
          content: "Could not answer",
          statusInfo: { status: "error", detail: "rate_limited" },
          attachments: [{ type: "file", label: "log.txt", path: "logs/log.txt" }],
        }),
        {
          id: "s1",
          sessionId: "s1",
          role: "system",
          content: "System note",
          timestamp: "10:01",
          timestampRaw: Date.UTC(2026, 0, 1, 10, 1),
        },
      ],
    });

    fireEvent.scroll(screen.getByText("Please read this").closest(".workspace-chat-content")!);
    expect(onScrollContainer).toHaveBeenCalled();
    expect(screen.getByText("Rate limited")).toBeTruthy();
    expect(screen.getByText("Too many requests were sent at once. Try again in a moment.")).toBeTruthy();
    expect(screen.getByText("System note")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /input.pdf/ }));
    fireEvent.click(screen.getByRole("button", { name: /log.txt/ }));
    expect(onOpenFile).toHaveBeenCalledWith("attachments/input.pdf");
    expect(onOpenFile).toHaveBeenCalledWith("logs/log.txt");

    fireEvent.click(screen.getAllByTitle("Copy message")[0]);
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
  });

  it("toggles reasoning, copies text parts, shows token details, and groups timestamps", async () => {
    const { container } = renderMessages({
      messages: [
        assistantMessage(
          [
            { type: "text", id: "text-copy", text: "Visible answer" },
            { type: "reasoning", id: "reasoning-copy", text: "Hidden **thought**" },
            { type: "step-finish", id: "finish-copy", reason: "done", cost: 0.01, tokens: { input: 1200, output: 300 } },
          ],
          { content: "Visible answer\nHidden **thought**" }
        ),
        assistantMessage([], {
          id: "a3",
          content: "Same minute follow-up",
          timestamp: "10:00",
          timestampRaw: Date.UTC(2026, 0, 1, 10, 0, 30),
        }),
        assistantMessage([], {
          id: "a4",
          content: "Later follow-up",
          timestamp: "10:02",
          timestampRaw: Date.UTC(2026, 0, 1, 10, 2),
        }),
      ],
    });

    expect(screen.queryByText("Hidden **thought**")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    const renderedMarkdown = screen.getByText("thought");
    expect(renderedMarkdown.tagName).toBe("STRONG");

    fireEvent.click(screen.getAllByTitle("Copy message")[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Visible answer"));

    const infoButton = screen.getAllByTitle("Copy message")[0].parentElement?.querySelector("div.relative button");
    expect(infoButton).toBeTruthy();

    expect(container.textContent?.match(/10:00/g)).toHaveLength(1);
    expect(screen.getByText("10:02")).toBeTruthy();
  });

  it("renders fallback chat error copy variants", () => {
    renderMessages({
      messages: [
        assistantMessage([], {
          id: "err-default",
          content: "Default failure",
          statusInfo: { status: "error", detail: "   " },
        }),
        assistantMessage([], {
          id: "err-code",
          content: "Code failure",
          statusInfo: { status: "error", detail: "model_overloaded" },
        }),
        assistantMessage([], {
          id: "err-text",
          content: "Text failure",
          statusInfo: { status: "error", detail: "Upstream API failed!" },
        }),
        assistantMessage([], {
          id: "err-known",
          content: "Known failure",
          statusInfo: { status: "error", detail: "unauthorized" },
        }),
      ],
    });

    expect(screen.getAllByText("Message failed")).toHaveLength(3);
    expect(screen.getByText("Something went wrong before the assistant could answer.")).toBeTruthy();
    expect(screen.getByText("Model overloaded")).toBeTruthy();
    expect(screen.getByText("Upstream API failed!")).toBeTruthy();
    expect(screen.getByText("Session expired")).toBeTruthy();
  });

  it("renders additional tool display branches and expanded multi-call details", () => {
    const parts: MessagePart[] = [
      { type: "tool", id: "read-ok", name: "read", state: { status: "completed", input: { filePath: "/workspace/project/src/one.ts" }, output: "", title: "Read one" } },
      { type: "tool", id: "read-run", name: "read", state: { status: "running", input: { filePath: "/workspace/project/src/two.ts" }, title: "Read two" } },
      { type: "tool", id: "read-error", name: "read", state: { status: "error", input: { filePath: "/workspace/project/src/bad.ts" }, error: "missing file" } },
      { type: "tool", id: "glob-extra", name: "glob", state: { status: "completed", input: { pattern: "**/*.md", include: "*.md", path: "/workspace/project/docs" }, output: "", title: "Glob" } },
      { type: "tool", id: "list-root", name: "list", state: { status: "completed", input: { path: "" }, output: "", title: "List root" } },
      { type: "tool", id: "write-extra", name: "write", state: { status: "completed", input: { filePath: "/workspace/project/docs/new.md" }, output: "", title: "Write" } },
      { type: "tool", id: "patch-one", name: "apply_patch", state: { status: "completed", input: { files: ["/workspace/project/src/one.ts"] }, output: "", title: "Patch" } },
      { type: "tool", id: "web-extra", name: "webfetch", state: { status: "completed", input: { url: "https://example.com", format: "markdown" }, output: "", title: "Fetch" } },
      { type: "tool", id: "custom-tool", name: "custom_tool", state: { status: "completed", input: {}, output: "", title: "" } },
      { type: "tool", id: "connector-tool", name: "arche_linear_conn-1_create_issue", state: { status: "completed", input: {}, output: "", title: "Create issue" } },
      { type: "tool", id: "todo-empty", name: "todowrite", state: { status: "pending", input: { todos: [{ status: "blocked" }, null] } } },
      { type: "tool", id: "task-error", name: "task", state: { status: "error", input: { description: "Try work" }, error: "agent failed" } },
    ];
    const { onOpenFile, onSelectSessionTab } = renderMessages({
      messages: [assistantMessage(parts)],
      onSelectSessionTab: undefined,
      sessionTabs: [],
    });

    expect(screen.getByText(/3 calls/)).toBeTruthy();
    expect(screen.getByText("1 done · 1 running · 1 error")).toBeTruthy();
    fireEvent.click(screen.getByText("Reading file"));
    expect(screen.getByText("missing file")).toBeTruthy();

    expect(screen.getByText(/pattern=\*\*\/\*\.md/)).toBeTruthy();
    expect(screen.getByText("in /")).toBeTruthy();
    expect(screen.getByText(/docs\/new\.md/)).toBeTruthy();
    expect(screen.getAllByText("one.ts")[0]).toBeTruthy();
    expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy();
    expect(screen.getByText("Custom tool")).toBeTruthy();
    expect(screen.getByText("Using Linear")).toBeTruthy();
    expect(screen.getByText("create issue")).toBeTruthy();
    expect(screen.getByText("Planning")).toBeTruthy();
    expect(screen.getByText("Delegated task")).toBeTruthy();
    expect(screen.getByText("agent failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();

    fireEvent.click(screen.getAllByText("Open")[0]);
    expect(onOpenFile).toHaveBeenCalledWith("src/one.ts");
    expect(onSelectSessionTab).not.toHaveBeenCalled();
  });

  it("renders collapsed file groups and standalone file parts", () => {
    const { onOpenFile } = renderMessages({
      messages: [assistantMessage([
        { type: "file", id: "f1", path: "docs/one.md", filename: "one.md" },
        { type: "file", id: "f2", path: "docs/two.md", filename: "two.md" },
        { type: "file", id: "f3", path: "docs/three.md", filename: "three.md" },
        { type: "text", id: "break", text: "break files" },
        { type: "file", id: "f4", path: "", filename: "missing.md" },
        { type: "patch", id: "patch-single", files: ["one.md"] },
      ])],
    });

    expect(screen.getByText("3 files")).toBeTruthy();
    expect(screen.getByText("Show")).toBeTruthy();
    fireEvent.click(screen.getByText("Files"));
    expect(screen.getByText("Hide")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /three.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith("docs/three.md");

    fireEvent.click(screen.getByRole("button", { name: /missing.md/ }));
    expect(onOpenFile).not.toHaveBeenCalledWith("");
    expect(screen.getByText("Changes in 1 file")).toBeTruthy();
  });

  it("renders running email drafts and copies subject and body", async () => {
    renderMessages({
      messages: [assistantMessage([
        {
          type: "tool",
          id: "email-running",
          name: "email_draft",
          state: { status: "running", input: {}, title: "Drafting" },
        },
        {
          type: "tool",
          id: "email-complete",
          name: "email_draft",
          state: {
            status: "completed",
            input: {},
            output: JSON.stringify({ subject: "Quarterly update", body: "Body text", to: ["a@example.com"], cc: ["c@example.com"], bcc: ["b@example.com"] }),
            title: "Drafted",
          },
        },
      ])],
    });

    expect(screen.getByText("Updating")).toBeTruthy();
    expect(screen.getByText("Cc:")).toBeTruthy();
    expect(screen.getByText("c@example.com")).toBeTruthy();
    expect(screen.getByText("Bcc:")).toBeTruthy();
    expect(screen.getByText("b@example.com")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Copy subject"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Quarterly update"));

    fireEvent.click(screen.getByLabelText("Copy body"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Body text"));
  });
});
