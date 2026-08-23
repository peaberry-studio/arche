import type { MessagePart } from "@/lib/opencode/types";
import type { ChatMessage } from "@/types/workspace";

type IsStreamingReasoningPartArgs = {
  isSessionBusy: boolean;
  isLastMessage: boolean;
  message: ChatMessage;
  part: MessagePart;
};

/**
 * A reasoning block is streaming while the session is busy, the message is the
 * latest assistant message, and the reasoning part is the last part of it.
 * Once another part (text, tool, step-finish…) or a new message arrives, the
 * block is complete and the indicator disappears.
 */
export function isStreamingReasoningPart({
  isSessionBusy,
  isLastMessage,
  message,
  part,
}: IsStreamingReasoningPartArgs): boolean {
  if (!isSessionBusy || !isLastMessage) return false;
  if (message.role !== "assistant") return false;
  if (part.type !== "reasoning") return false;

  const parts = message.parts ?? [];
  if (parts.length === 0) return false;

  return part === parts[parts.length - 1];
}
