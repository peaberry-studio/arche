"use client";

import { Node, type MarkdownToken, type MarkdownTokenizer } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

import { KaTeXRenderer } from "@/components/workspace/katex-renderer";

const INLINE_MATH_PATTERN = /^\$((?:\\.|[^$\n])+?)\$(?!\d)/u;

const mathInlineTokenizer: MarkdownTokenizer = {
  name: "mathInline",
  level: "inline",
  start: (src) => src.indexOf("$"),
  tokenize: (src) => {
    const match = INLINE_MATH_PATTERN.exec(src);
    if (!match) return undefined;
    const content = match[1];
    if (/^\s|\s$/.test(content)) return undefined;
    return { type: "mathInline", raw: match[0], text: content };
  },
};

function MathInlineNodeView({ node }: NodeViewProps) {
  const content = typeof node.attrs.content === "string" ? node.attrs.content : "";
  return (
    <NodeViewWrapper as="span">
      <KaTeXRenderer content={content} displayMode={false} />
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { content: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML() {
    return ["span", { "data-math-inline": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineNodeView);
  },

  markdownTokenName: "mathInline",

  markdownTokenizer: mathInlineTokenizer,

  parseMarkdown: (token: MarkdownToken) => {
    return {
      type: "mathInline",
      attrs: { content: token.text ?? "" },
    };
  },

  renderMarkdown: (node: { attrs?: { content?: string } | null }) => {
    const content = node.attrs?.content ?? "";
    return "$" + content + "$";
  },
});
