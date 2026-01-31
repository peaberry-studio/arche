/**
 * UI types for workspace components.
 * These are the shapes expected by UI components, independent of the OpenCode SDK types.
 */

export type ChatSession = {
  id: string;
  title: string;
  status: "active" | "idle" | "archived";
  updatedAt: string;
  agent: string;
};

/**
 * Status types for streaming message state.
 */
export type MessageStatus = 
  | "idle"
  | "thinking"
  | "reasoning" 
  | "tool-calling"
  | "writing"
  | "complete"
  | "error";

/**
 * Extended status info for display during streaming.
 */
export type MessageStatusInfo = {
  status: MessageStatus;
  toolName?: string;  // Name of tool being called
  detail?: string;    // Additional detail (e.g., file being written)
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  attachments?: Array<{
    type: "file" | "snippet";
    label: string;
    path?: string;
  }>;
  /** Status info for streaming messages */
  statusInfo?: MessageStatusInfo;
  /** Whether the message is pending (being sent/received) */
  pending?: boolean;
};
