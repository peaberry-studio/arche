import { Check } from "@phosphor-icons/react";
import type { Components } from "react-markdown";

import { MarkdownChart } from "@/components/workspace/markdown-chart";
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
  code: ({ className, children, ...props }) => {
    if (typeof className === "string" && className.includes("language-vega-lite")) {
      return <MarkdownChart source={String(children)} />;
    }

    return <code className={className} {...props}>{children}</code>;
  },
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
  pre: ({ node, children }) => {
    const codeChild = (node as HastElement | undefined)?.children?.[0] as HastElement | undefined;
    const classes = codeChild?.properties?.className;
    if (Array.isArray(classes) && classes.includes("language-vega-lite")) {
      return <>{children}</>;
    }

    return <pre>{children}</pre>;
  },
};
