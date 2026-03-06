/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/workspace/chat-panel";

vi.mock("next/image", () => ({
  default: () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPanel textarea", () => {
  it("resets textarea height after sending a multiline message", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ attachments: [] }),
      })
    );

    render(
      <ChatPanel
        slug={"alice"}
        sessions={[{ id: "s1", title: "Chat", status: "idle", updatedAt: "now", agent: "OpenCode" }]}
        messages={[]}
        activeSessionId={"s1"}
        openFilePaths={[]}
        onCloseSession={vi.fn()}
        onOpenFile={vi.fn()}
        onSendMessage={onSendMessage}
      />
    );

    const textarea = screen.getByPlaceholderText("Type a message...");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Expected textarea element");
    }

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 180,
    });

    fireEvent.change(textarea, { target: { value: "Line 1\nLine 2\nLine 3\nLine 4" } });

    await waitFor(() => {
      expect(textarea.style.height).toBe("180px");
    });

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(textarea.value).toBe("");
      expect(textarea.style.height).toBe("auto");
    });
  });
});
