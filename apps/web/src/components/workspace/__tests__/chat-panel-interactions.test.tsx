/** @vitest-environment jsdom */

import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/workspace/chat-panel";
import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
import type { ChatMessage, ChatSession } from "@/types/workspace";

vi.mock("next/image", () => ({
  default: () => null,
}));

const baseSessions: ChatSession[] = [
  {
    id: "s1",
    title: "Planning",
    status: "idle",
    updatedAt: "now",
    agent: "OpenCode",
  },
];

function openSessionMenu() {
  const trigger = screen.getByRole("button", { name: /session options for planning/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

function renderChatPanel(overrides?: Partial<ComponentProps<typeof ChatPanel>>) {
  return render(
    <WorkspaceThemeProvider storageScope="alice">
      <ChatPanel
        slug="alice"
        sessions={baseSessions}
        messages={[]}
        activeSessionId="s1"
        openFilePaths={[]}
        onCloseSession={() => {}}
        onOpenFile={() => {}}
        onSendMessage={async () => true}
        {...overrides}
      />
    </WorkspaceThemeProvider>
  );
}

describe("ChatPanel interactions", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renames the active session inline by clicking the title", async () => {
    const renameSessionSpy = vi.fn(async (id: string, title: string) => {
      return { id, title };
    });

    function Harness() {
      const [sessions, setSessions] = useState(baseSessions);

      return (
        <WorkspaceThemeProvider storageScope="alice">
          <ChatPanel
            slug="alice"
            sessions={sessions}
            messages={[]}
            activeSessionId="s1"
            openFilePaths={[]}
            onCloseSession={() => {}}
            onOpenFile={() => {}}
            onRenameSession={async (id, title) => {
              await renameSessionSpy(id, title);
              setSessions((previous) =>
                previous.map((session) =>
                  session.id === id ? { ...session, title } : session
                )
              );
              return true;
            }}
            onSendMessage={async () => true}
          />
        </WorkspaceThemeProvider>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /rename session planning/i }));

    const input = screen.getByRole("textbox", { name: /session title/i });

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    fireEvent.change(input, { target: { value: "Release plan" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(renameSessionSpy).toHaveBeenCalledTimes(1);
      expect(renameSessionSpy).toHaveBeenCalledWith("s1", "Release plan");
    });

    await waitFor(() => {
      expect(screen.getByText("Release plan")).toBeTruthy();
    });
  });

  it("exports the active conversation to markdown", async () => {
    const createObjectURL = vi.fn(() => "blob:session-export");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        role: "user",
        content: "Summarize the roadmap",
        timestamp: "now",
      },
      {
        id: "m2",
        sessionId: "s1",
        role: "assistant",
        content: "",
        timestamp: "now",
        parts: [
          {
            type: "tool",
            id: "tool-1",
            name: "grep",
            state: { status: "completed", input: {}, output: "", title: "done" },
          },
          { type: "text", text: "Roadmap summary" },
        ],
      },
    ];

    renderChatPanel({ messages });

    openSessionMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /export to md/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:session-export");

    expect(createObjectURL.mock.calls[0][0]).toBeTruthy();
  });

  it("copies only the email draft payload from the dedicated email card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const messages: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        role: "assistant",
        content: "",
        timestamp: "now",
        parts: [
          {
            type: "tool",
            id: "tool-email-1",
            name: "email_draft",
            state: {
              status: "completed",
              input: {},
              output: JSON.stringify({
                ok: true,
                format: "email-draft",
                subject: "Follow-up on Q2 proposal",
                body: "Hi Ana,\n\nThanks for your time today.",
                to: ["ana@example.com"],
              }),
              title: "email draft",
            },
          },
          {
            type: "text",
            text: "If you want, I can make it more formal.",
          },
        ],
      },
    ];

    renderChatPanel({ messages });

    fireEvent.click(screen.getByRole("button", { name: /copy email draft/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    const copiedText = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copiedText).toContain("Subject: Follow-up on Q2 proposal");
    expect(copiedText).toContain("Hi Ana,");
    expect(copiedText).not.toContain("If you want, I can make it more formal.");
  });
});
