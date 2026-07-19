"use client";

import { useMemo } from "react";

import katex from "katex";

type KaTeXRendererProps = {
  content: string;
  displayMode: boolean;
};

export function KaTeXRenderer({ content, displayMode }: KaTeXRendererProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(content, {
        displayMode,
        throwOnError: false,
      });
    } catch {
      return null;
    }
  }, [content, displayMode]);

  if (!html) {
    return <span style={{ color: "#cc0000" }}>{content}</span>;
  }

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
