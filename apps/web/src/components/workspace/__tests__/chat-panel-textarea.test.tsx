/** @vitest-environment jsdom */

import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/workspace/chat-panel";
import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";

vi.mock("next/image", () => ({
  default: () => null,
}));

type MockAttachment = {
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  uploadedAt: number;
};

const defaultModel = {
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5.4",
  modelName: "GPT 5.4",
  isDefault: false,
};

function renderChatPanel(
  onSendMessage = vi.fn().mockResolvedValue(true),
  props?: Partial<ComponentProps<typeof ChatPanel>>
) {
  render(
    <WorkspaceThemeProvider storageScope="alice">
      <ChatPanel
        slug={"alice"}
        sessions={[{ id: "s1", title: "Chat", status: "idle", updatedAt: "now", agent: "OpenCode" }]}
        messages={[]}
        activeSessionId={"s1"}
        openFilePaths={[]}
        onCloseSession={vi.fn()}
        onOpenFile={vi.fn()}
        onSendMessage={onSendMessage}
        {...props}
      />
    </WorkspaceThemeProvider>
  );

  return { onSendMessage };
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = screen.getByPlaceholderText("Type a message...");
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("Expected textarea element");
  }
  return textarea;
}

function getSendButton(): HTMLButtonElement {
  const sendButton = screen.getByRole("button", { name: "Send message" });
  if (!(sendButton instanceof HTMLButtonElement)) {
    throw new Error("Expected send button element");
  }
  return sendButton;
}

function createClipboardImageData(file: File) {
  return {
    items: [
      {
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      },
    ],
    files: [file],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatPanel textarea", () => {
  it("does not load or render attachments when attachments are disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel(undefined, { attachmentsEnabled: false });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.some(([input]) => input === "/api/w/alice/attachments")
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Manage attachments" })).toBeNull();
  });

  it("focuses the composer when switching to a new active session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    const onCloseSession = vi.fn();
    const onOpenFile = vi.fn();

    const renderPanel = (activeSessionId: "s1" | "s2") => (
      <WorkspaceThemeProvider storageScope="alice">
        <ChatPanel
          key={activeSessionId}
          slug="alice"
          sessions={[
            { id: "s1", title: "Chat 1", status: "idle", updatedAt: "now", agent: "OpenCode" },
            { id: "s2", title: "Chat 2", status: "idle", updatedAt: "now", agent: "OpenCode" },
          ]}
          messages={[]}
          activeSessionId={activeSessionId}
          openFilePaths={[]}
          onCloseSession={onCloseSession}
          onOpenFile={onOpenFile}
          onSendMessage={onSendMessage}
        />
      </WorkspaceThemeProvider>
    );

    const { rerender } = render(renderPanel("s1"));

    const firstTextarea = getTextarea();
    firstTextarea.blur();

    rerender(renderPanel("s2"));

    await waitFor(() => {
      expect(document.activeElement).toBe(getTextarea());
    });
  });

  it("resets textarea height after sending a multiline message", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(true);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ attachments: [] }),
      })
    );

    renderChatPanel(onSendMessage);

    const textarea = getTextarea();

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

  it("allows typing during streaming but keeps Enter from sending", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    const onAbortMessage = vi.fn();

    renderChatPanel(onSendMessage, {
      isSending: true,
      onAbortMessage,
    });

    const textarea = getTextarea();

    expect(textarea.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Cancel response" })).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "next prompt draft" } });

    expect(textarea.value).toBe("next prompt draft");

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("uploads a pasted image and sends it without requiring text", async () => {
    const attachmentStore: MockAttachment[] = [];
    const uploadedAttachment: MockAttachment = {
      id: ".arche/attachments/clipboard-image.png",
      path: ".arche/attachments/clipboard-image.png",
      name: "clipboard-image.png",
      mime: "image/png",
      size: 12,
      uploadedAt: 1,
    };

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const requestBody = init.body;
        if (!(requestBody instanceof FormData)) {
          throw new Error("Expected upload request body to be FormData");
        }

        const files = requestBody.getAll("files");
        expect(files).toHaveLength(1);

        const uploadedFile = files[0];
        if (!(uploadedFile instanceof File)) {
          throw new Error("Expected uploaded file in FormData");
        }

        expect(uploadedFile.type).toBe("image/png");
        expect(uploadedFile.name).toBe("clipboard-image.png");

        attachmentStore.push(uploadedAttachment);

        return {
          ok: true,
          json: async () => ({ uploaded: [uploadedAttachment], failed: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ attachments: attachmentStore }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    renderChatPanel(onSendMessage);

    const textarea = getTextarea();
    const imageFile = new File(["image"], "clipboard-image.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: createClipboardImageData(imageFile),
    });

    await waitFor(() => {
      expect(screen.getByText("clipboard-image.png")).toBeTruthy();
    });

    const sendButton = getSendButton();
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });

    expect(onSendMessage).toHaveBeenCalledWith(
      "",
      undefined,
      {
        attachments: [
          {
            path: uploadedAttachment.path,
            filename: uploadedAttachment.name,
            mime: uploadedAttachment.mime,
          },
        ],
        contextPaths: [],
      }
    );
  });

  it("does not trigger uploads when pasted clipboard data has no images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });

    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const initialFetchCount = fetchMock.mock.calls.length;

    const textarea = getTextarea();
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
        files: [],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(initialFetchCount);
    });
  });

  it("disables send while a pasted image upload is in progress", async () => {
    const attachmentStore: MockAttachment[] = [];
    const uploadedAttachment: MockAttachment = {
      id: ".arche/attachments/slow-upload.png",
      path: ".arche/attachments/slow-upload.png",
      name: "slow-upload.png",
      mime: "image/png",
      size: 9,
      uploadedAt: 1,
    };

    let resolveUpload: (() => void) | null = null;
    const uploadResponse = new Promise<{
      ok: boolean;
      json: () => Promise<{ uploaded: MockAttachment[]; failed: [] }>;
    }>((resolve) => {
      resolveUpload = () => {
        attachmentStore.push(uploadedAttachment);
        resolve({
          ok: true,
          json: async () => ({ uploaded: [uploadedAttachment], failed: [] }),
        });
      };
    });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return uploadResponse;
      }

      return {
        ok: true,
        json: async () => ({ attachments: attachmentStore }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel();

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "hello" } });

    const sendButton = getSendButton();
    expect(sendButton.disabled).toBe(false);

    const imageFile = new File(["image"], "slow-upload.png", { type: "image/png" });
    fireEvent.paste(textarea, {
      clipboardData: createClipboardImageData(imageFile),
    });

    await waitFor(() => {
      expect(sendButton.disabled).toBe(true);
    });

    if (!resolveUpload) {
      throw new Error("Expected upload resolver");
    }
    resolveUpload();

    await waitFor(() => {
      expect(sendButton.disabled).toBe(false);
    });
  });

  it("does not send a model override when only the agent default is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    renderChatPanel(onSendMessage, {
      models: [defaultModel],
      selectedModel: defaultModel,
      hasManualModelSelection: false,
      agentDefaultModel: defaultModel,
    });

    fireEvent.change(getTextarea(), { target: { value: "hello" } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });

    expect(onSendMessage).toHaveBeenCalledWith("hello", undefined, {
      attachments: [],
      contextPaths: [],
    });
  });

  it("sends a model override when the user selected one manually", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    renderChatPanel(onSendMessage, {
      models: [defaultModel],
      selectedModel: defaultModel,
      hasManualModelSelection: true,
      agentDefaultModel: defaultModel,
    });

    fireEvent.change(getTextarea(), { target: { value: "hello" } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });

    expect(onSendMessage).toHaveBeenCalledWith(
      "hello",
      { providerId: "openai", modelId: "gpt-5.4" },
      {
        attachments: [],
        contextPaths: [],
      }
    );
  });

  it("focuses model search input when opening the model selector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [], connectors: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel(undefined, {
      models: [defaultModel],
      selectedModel: defaultModel,
      hasManualModelSelection: false,
      agentDefaultModel: defaultModel,
    });

    const modelTrigger = screen.getByRole("button", { name: /gpt 5\.4/i });
    fireEvent.pointerDown(modelTrigger, { button: 0 });

    const searchInput = await screen.findByPlaceholderText("Search models...");
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("does not auto-scroll when the user has scrolled away from the bottom", async () => {
    // Globally stub scrollIntoView which doesn't exist in jsdom
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatPanel
          slug={"alice"}
          sessions={[{ id: "s1", title: "Chat", status: "idle", updatedAt: "now", agent: "OpenCode" }]}
          messages={[
            { id: "m1", sessionId: "s1", role: "assistant", content: "Hello", timestamp: "now" },
          ]}
          activeSessionId={"s1"}
          openFilePaths={[]}
          onCloseSession={vi.fn()}
          onOpenFile={vi.fn()}
          onSendMessage={vi.fn().mockResolvedValue(true)}
        />
      </WorkspaceThemeProvider>
    );

    // Initial load triggers scroll — clear and set up for the real assertion
    scrollIntoViewMock.mockClear();

    // Find the scroll container and simulate the user scrolling up
    const scrollContainer = document.querySelector(".workspace-chat-content");
    expect(scrollContainer).toBeTruthy();

    Object.defineProperty(scrollContainer!, "scrollTop", { value: 0, writable: true, configurable: true });
    Object.defineProperty(scrollContainer!, "clientHeight", { value: 400, writable: true, configurable: true });
    Object.defineProperty(scrollContainer!, "scrollHeight", { value: 2000, writable: true, configurable: true });
    fireEvent.scroll(scrollContainer!);

    scrollIntoViewMock.mockClear();

    // Re-render with updated messages (simulates new streaming content)
    rerender(
      <WorkspaceThemeProvider storageScope="alice">
        <ChatPanel
          slug={"alice"}
          sessions={[{ id: "s1", title: "Chat", status: "idle", updatedAt: "now", agent: "OpenCode" }]}
          messages={[
            { id: "m1", sessionId: "s1", role: "assistant", content: "Hello", timestamp: "now" },
            { id: "m2", sessionId: "s1", role: "assistant", content: "New content", timestamp: "now", pending: true },
          ]}
          activeSessionId={"s1"}
          openFilePaths={[]}
          onCloseSession={vi.fn()}
          onOpenFile={vi.fn()}
          onSendMessage={vi.fn().mockResolvedValue(true)}
        />
      </WorkspaceThemeProvider>
    );

    // scrollIntoView should NOT have been called because user scrolled away
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("renders subagent sessions as read-only inspection views", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onReturnToMainConversation = vi.fn();

    renderChatPanel(undefined, {
      isReadOnly: true,
      onReturnToMainConversation,
    });

    expect(
      screen.getByText(
        "Subagent sessions are read-only. Return to the main conversation to continue chatting."
      )
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Type a message...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Main conversation" }));
    expect(onReturnToMainConversation).toHaveBeenCalledTimes(1);
  });
});
