export type ContextMode = "auto" | "manual" | "off";

export type SessionTabInfo = {
  id: string;
  title: string;
  depth: number;
  status?: string;
};
