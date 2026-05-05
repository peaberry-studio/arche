/** @vitest-environment jsdom */

import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/components/workspace/chat-panel";
import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_ATTACHMENT_UPLOAD_MEGABYTES,
} from "@/lib/workspace-attachments";

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
  delete (window as Window & { arche?: unknown }).arche;
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
        if (!(requestBody instanceof File)) {
          throw new Error("Expected upload request body to be a File");
        }

        expect(requestBody.type).toBe("image/png");
        expect(requestBody.name).toBe("clipboard-image.png");
        expect(String(_input)).toBe(
          "/api/w/alice/attachments?filename=clipboard-image.png"
        );

        attachmentStore.push(uploadedAttachment);

        return {
          ok: true,
          status: 201,
          json: async () => ({ attachment: uploadedAttachment }),
        };
      }

      return {
        ok: true,
        status: 200,
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

  it("shows a clear error when a pasted image exceeds the upload limit", async () => {
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

    const oversizedFile = new File(["image"], "too-large.png", { type: "image/png" });
    Object.defineProperty(oversizedFile, "size", {
      value: MAX_ATTACHMENT_UPLOAD_BYTES + 1,
    });

    fireEvent.paste(getTextarea(), {
      clipboardData: createClipboardImageData(oversizedFile),
    });

    expect(
      await screen.findByText(
        `You can't upload files larger than ${MAX_ATTACHMENT_UPLOAD_MEGABYTES} MB.`
      )
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(initialFetchCount);
  });

  it("shows a desktop-only reveal attachments action in the manage dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const revealAttachmentsDirectory = vi.fn().mockResolvedValue({ ok: true });
    (window as Window & { arche?: unknown }).arche = {
      isDesktop: true,
      platform: "darwin",
      desktop: {
        revealAttachmentsDirectory,
      },
    };

    renderChatPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Attach files" }));
    await screen.findByText("Upload file");
    fireEvent.click(screen.getByText("Manage attachments"));

    const revealButton = await screen.findByRole("button", { name: "Reveal in Finder" });
    fireEvent.click(revealButton);

    await waitFor(() => {
      expect(revealAttachmentsDirectory).toHaveBeenCalledTimes(1);
    });
  });

  it("filters, selects, renames, and deletes managed attachments", async () => {
    let attachments: MockAttachment[] = [
      {
        id: ".arche/attachments/alpha.pdf",
        path: ".arche/attachments/alpha.pdf",
        name: "alpha.pdf",
        mime: "application/pdf",
        size: 1200,
        uploadedAt: 10,
      },
      {
        id: ".arche/attachments/brief.txt",
        path: ".arche/attachments/brief.txt",
        name: "brief.txt",
        mime: "text/plain",
        size: 300,
        uploadedAt: 20,
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/w/alice/attachments" && !init?.method) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ attachments }),
        };
      }

      if (String(input) === "/api/w/alice/attachments" && init?.method === "PATCH") {
        const updated = {
          ...attachments[0],
          id: ".arche/attachments/renamed.pdf",
          path: ".arche/attachments/renamed.pdf",
          name: "renamed.pdf",
        };
        attachments = [updated, attachments[1]];
        return {
          ok: true,
          status: 200,
          json: async () => ({ attachment: updated }),
        };
      }

      if (String(input) === "/api/w/alice/attachments" && init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        attachments = attachments.filter((attachment) => attachment.path !== body.path);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ connectors: [] }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "prompt").mockReturnValue("renamed.pdf");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderChatPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Attach files" }));
    fireEvent.click(await screen.findByText("Manage attachments"));

    expect(await screen.findByText("alpha.pdf")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search attachments..."), {
      target: { value: "brief" },
    });
    expect(screen.queryByText("alpha.pdf")).toBeNull();
    expect(screen.getByText("brief.txt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select brief.txt" }));
    expect(screen.getByText("1 file selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Attach 1 file" }));

    fireEvent.pointerDown(screen.getByRole("button", { name: /Attach files/ }));
    fireEvent.click(await screen.findByText("Manage attachments"));
    fireEvent.change(screen.getByPlaceholderText("Search attachments..."), {
      target: { value: "" },
    });

    fireEvent.click(screen.getAllByTitle("Rename")[0]);
    expect(await screen.findByText("renamed.pdf")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search attachments..."), {
      target: { value: "renamed" },
    });
    fireEvent.click(screen.getAllByTitle("Delete")[0]);
    await waitFor(() => {
      expect(screen.queryByText("renamed.pdf")).toBeNull();
    });
  });

  it("sends selected context paths, experts, and skills", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [], connectors: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    renderChatPanel(onSendMessage, {
      agents: [
        { id: "assistant", displayName: "Assistant", isPrimary: true },
        { id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false },
      ],
      contextFilePaths: ["docs/a.md", "notes/b.md"],
      openFilePaths: ["docs/a.md"],
      skills: [
        {
          name: "pdf-processing",
          description: "Process PDFs",
          assignedAgentIds: [],
          hasResources: false,
          resourcePaths: [],
        },
      ],
    });

    const attachButton = screen.getByRole("button", { name: "Attach files" });
    fireEvent.pointerDown(attachButton);
    fireEvent.click(await screen.findByText("docs/a.md"));
    fireEvent.click(screen.getByText("Clear selection"));
    fireEvent.click(screen.getByText("docs/a.md"));
    fireEvent.pointerDown(attachButton);

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Attach files" })).toBeNull();
    });

    const expertsButton = screen.getByRole("button", { name: "Experts" });
    fireEvent.pointerDown(expertsButton);
    fireEvent.click(await screen.findByText("Ads Scripts"));
    fireEvent.pointerDown(expertsButton);

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /Experts/ })).toBeNull();
    });

    const skillsButton = screen.getByRole("button", { name: "Skills" });
    fireEvent.pointerDown(skillsButton);
    fireEvent.click(await screen.findByText("pdf-processing"));
    fireEvent.pointerDown(skillsButton);

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /Skills/ })).toBeNull();
    });

    fireEvent.change(getTextarea(), { target: { value: "Use the selected context" } });
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });

    expect(onSendMessage).toHaveBeenCalledWith(
      "@ads-scripts /pdf-processing\n\nUse the selected context",
      undefined,
      {
        attachments: [],
        contextPaths: ["docs/a.md"],
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

  it("accepts an expert mention suggestion with Enter and inserts the agent id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSendMessage = vi.fn().mockResolvedValue(true);
    renderChatPanel(onSendMessage, {
      agents: [
        { id: "assistant", displayName: "Assistant", isPrimary: true },
        { id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false },
        { id: "seo", displayName: "SEO", isPrimary: false },
      ],
    });

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Ask @ads" } });
    textarea.setSelectionRange("Ask @ads".length, "Ask @ads".length);
    fireEvent.select(textarea);

    expect(await screen.findByRole("button", { name: /ads scripts/i })).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(textarea.value).toBe("Ask @ads-scripts ");
    });

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /ads scripts/i })).toBeNull();
  });

  it("closes expert mention suggestions when the composer loses focus", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel(undefined, {
      agents: [
        { id: "assistant", displayName: "Assistant", isPrimary: true },
        { id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false },
      ],
    });

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Ask @ads" } });
    textarea.setSelectionRange("Ask @ads".length, "Ask @ads".length);
    fireEvent.select(textarea);

    expect(await screen.findByRole("button", { name: /ads scripts/i })).toBeTruthy();

    textarea.focus();
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /ads scripts/i })).toBeNull();
    });
  });

  it("renders expert mention suggestions in a fixed popover anchored to the caret", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel(undefined, {
      agents: [
        { id: "assistant", displayName: "Assistant", isPrimary: true },
        { id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false },
      ],
    });

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Ask @ads" } });
    textarea.setSelectionRange("Ask @ads".length, "Ask @ads".length);
    fireEvent.select(textarea);

    const suggestion = await screen.findByRole("button", { name: /ads scripts/i });
    const popover = suggestion.closest('[role="presentation"]');

    expect(popover).toBeTruthy();

    if (!(popover instanceof HTMLDivElement)) {
      throw new Error("Expected popover container");
    }

    await waitFor(() => {
      expect(popover.style.visibility).toBe("visible");
    });

    expect(popover.style.position).toBe("fixed");
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
      status: number;
      json: () => Promise<{ attachment: MockAttachment }>;
    }>((resolve) => {
      resolveUpload = () => {
        attachmentStore.push(uploadedAttachment);
        resolve({
          ok: true,
          status: 201,
          json: async () => ({ attachment: uploadedAttachment }),
        });
      };
    });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return uploadResponse;
      }

      return {
        ok: true,
        status: 200,
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

  it("uploads multiple files sequentially and reports partial failures", async () => {
    const attachmentStore: MockAttachment[] = [];
    const firstAttachment: MockAttachment = {
      id: ".arche/attachments/first.png",
      path: ".arche/attachments/first.png",
      name: "first.png",
      mime: "image/png",
      size: 5,
      uploadedAt: 10,
    };

    const uploadOrder: string[] = [];
    let resolveFirstUpload: (() => void) | null = null;

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = init.body;
        if (!(body instanceof File)) {
          throw new Error("Expected upload request body to be a File");
        }

        uploadOrder.push(body.name);

        if (body.name === "first.png") {
          return await new Promise<{
            ok: boolean;
            status: number;
            json: () => Promise<{ attachment: MockAttachment }>;
          }>((resolve) => {
            resolveFirstUpload = () => {
              attachmentStore.push(firstAttachment);
              resolve({
                ok: true,
                status: 201,
                json: async () => ({ attachment: firstAttachment }),
              });
            };
          });
        }

        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "upload_failed" }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ attachments: attachmentStore }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    renderChatPanel();

    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected attachment file input");
    }

    fireEvent.change(input, {
      target: {
        files: [
          new File(["first"], "first.png", { type: "image/png" }),
          new File(["second"], "second.png", { type: "image/png" }),
        ],
      },
    });

    await waitFor(() => {
      expect(uploadOrder).toEqual(["first.png"]);
    });

    if (!resolveFirstUpload) {
      throw new Error("Expected first upload resolver");
    }
    resolveFirstUpload();

    await waitFor(() => {
      expect(uploadOrder).toEqual(["first.png", "second.png"]);
    });

    expect(await screen.findByText("Some files couldn't be uploaded.")).toBeTruthy();
    expect(await screen.findByText("second.png: Couldn't upload the selected file.")).toBeTruthy();
    expect(await screen.findByText("first.png")).toBeTruthy();
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
