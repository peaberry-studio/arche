"use client";

import { Node, type MarkdownToken, type MarkdownTokenizer } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

import { KaTeXRenderer } from "@/components/workspace/katex-renderer";

const DISPLAY_MATH_PATTERN = /^ {0,3}\$\$([\s\S]*?)\$\$(?!\$)/u;

const mathDisplayTokenizer: MarkdownTokenizer = {
  name: "mathDisplay",
  level: "block",
  tokenize: (src) => {
    const match = DISPLAY_MATH_PATTERN.exec(src);
    if (!match) return undefined;
    const content = match[1].trim();
    if (!content) return undefined;
    return { type: "mathDisplay", raw: match[0], text: content };
  },
};

function MathDisplayNodeView({ node }: NodeViewProps) {
  const content = typeof node.attrs.content === "string" ? node.attrs.content : "";
  return (
    <NodeViewWrapper as="div">
      <div className="my-2 overflow-x-auto rounded-md border border-border/30 bg-muted/10 px-3 py-2">
        <KaTeXRenderer content={content} displayMode={true} />
      </div>
    </NodeViewWrapper>
  );
}

export const MathDisplay = Node.create({
  name: "mathDisplay",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { content: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-math-display]" }];
  },

  renderHTML() {
    return ["div", { "data-math-display": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathDisplayNodeView);
  },

  markdownTokenName: "mathDisplay",

  markdownTokenizer: mathDisplayTokenizer,

  parseMarkdown: (token: MarkdownToken) => {
    return {
      type: "mathDisplay",
      attrs: { content: token.text ?? "" },
    };
  },

  renderMarkdown: (node: { attrs?: { content?: string } | null }) => {
    const content = node.attrs?.content ?? "";
    return "$$\n" + content + "\n$$";
  },
});
