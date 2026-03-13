import type { MessagePart } from "@/lib/opencode/types"
import type { ChatMessage } from "@/types/workspace"

type ExportableMessage = {
  role: "user" | "assistant"
  text: string
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim()
}

function extractAssistantText(parts?: MessagePart[]): string {
  if (!parts || parts.length === 0) return ""

  return parts
    .filter(
      (part): part is Extract<MessagePart, { type: "text" }> => part.type === "text"
    )
    .map((part) => normalizeText(part.text))
    .filter((part) => part.length > 0)
    .join("\n\n")
}

function getExportableMessage(message: ChatMessage): ExportableMessage | null {
  if (message.role === "system") return null

  if (message.role === "user") {
    const text = normalizeText(message.content)
    return text.length > 0 ? { role: "user", text } : null
  }

  const fromParts = extractAssistantText(message.parts)
  const text = normalizeText(fromParts || message.content)

  return text.length > 0 ? { role: "assistant", text } : null
}

function sanitizeTitleForFilename(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || "conversation"
}

export function getWorkspaceSessionExportFilename(title: string): string {
  return `${sanitizeTitleForFilename(title)}.md`
}

export function buildWorkspaceSessionMarkdown(
  title: string,
  messages: ChatMessage[]
): string {
  const resolvedTitle = normalizeText(title) || "Conversation"
  const exportableMessages = messages
    .map(getExportableMessage)
    .filter((message): message is ExportableMessage => message !== null)

  if (exportableMessages.length === 0) {
    return `# ${resolvedTitle}\n\n_No conversation content to export._\n`
  }

  const body = exportableMessages
    .map((message) => {
      const heading = message.role === "user" ? "User" : "Assistant"
      return `## ${heading}\n\n${message.text}`
    })
    .join("\n\n")

  return `# ${resolvedTitle}\n\n${body}\n`
}
