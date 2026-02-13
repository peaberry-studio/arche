import { Check } from "@phosphor-icons/react";
import type { Components } from "react-markdown";

import { cn } from "@/lib/utils";

type HastElement = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
};

function isTaskCheckboxElement(node: unknown): node is HastElement {
  if (!node || typeof node !== "object") return false;

  const candidate = node as HastElement;
  return candidate.type === "element" && candidate.tagName === "input" && candidate.properties?.type === "checkbox";
}

function paragraphHasTaskCheckbox(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;

  const paragraph = node as HastElement;
  if (!Array.isArray(paragraph.children)) return false;

  return paragraph.children.some(isTaskCheckboxElement);
}

export const workspaceMarkdownComponents: Components = {
  input: ({ type, checked, ...props }) => {
    if (type === "checkbox") {
      return (
        <span
          aria-hidden="true"
          className={cn("markdown-task-checkbox", Boolean(checked) && "is-checked")}
        >
          {checked ? <Check size={10} weight="bold" /> : null}
        </span>
      );
    }

    return <input type={type} {...props} />;
  },
  p: ({ node, children, ...props }) => {
    if (paragraphHasTaskCheckbox(node)) {
      return <span className="markdown-task-line">{children}</span>;
    }

    return <p {...props}>{children}</p>;
  },
};
