"use client";

import { Node, type MarkdownToken, type MarkdownTokenizer } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

import { MarkdownChart } from "@/components/workspace/markdown-chart";

const VEGA_LITE_FENCE_PATTERN =
  /^ {0,3}(`{3,}|~{3,})vega-lite[ \t]*(?:\n|$)([\s\S]*?)(?: {0,3}\1[~`]* *(?=\n|$)|$)/u;

const vegaLiteTokenizer: MarkdownTokenizer = {
  name: "vegaLiteChart",
  level: "block",
  tokenize: (src) => {
    const match = VEGA_LITE_FENCE_PATTERN.exec(src);
    if (!match) return undefined;
    const [, , body] = match;
    return {
      type: "vegaLiteChart",
      raw: match[0],
      text: body ?? "",
    };
  },
};

function VegaLiteChartNodeView({ node }: NodeViewProps) {
  const spec = typeof node.attrs.spec === "string" ? node.attrs.spec : "";
  return (
    <NodeViewWrapper as="div">
      <MarkdownChart source={spec} />
    </NodeViewWrapper>
  );
}

export const VegaLiteChart = Node.create({
  name: "vegaLiteChart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      spec: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-vega-lite-chart]" }];
  },

  renderHTML() {
    return ["div", { "data-vega-lite-chart": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VegaLiteChartNodeView);
  },

  markdownTokenName: "vegaLiteChart",

  markdownTokenizer: vegaLiteTokenizer,

  parseMarkdown: (token: MarkdownToken) => {
    return {
      type: "vegaLiteChart",
      attrs: {
        spec: token.text ?? "",
      },
    };
  },

  renderMarkdown: (node: { attrs?: { spec?: string } | null }) => {
    const spec = node.attrs?.spec ?? "";
    return "```vega-lite\n" + spec + "\n```";
  },
});
