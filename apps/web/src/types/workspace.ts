export type WorkspaceNode = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  children?: WorkspaceNode[];
};

export type WorkspaceFile = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
  size: string;
  kind: "markdown" | "text";
};

export type ChatSession = {
  id: string;
  title: string;
  status: "active" | "idle" | "archived";
  updatedAt: string;
  agent: string;
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
};

export type WorkspaceDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  diff: string;
};
