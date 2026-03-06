/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/workspace/chat-panel";

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

function renderChatPanel(onSendMessage = vi.fn().mockResolvedValue(undefined)) {
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

    const onSendMessage = vi.fn().mockResolvedValue(undefined);
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

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
      expect(fetchMock).toHaveBeenCalledTimes(1);
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
});
