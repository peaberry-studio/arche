/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownPreview } from "@/components/workspace/markdown-preview";

describe("MarkdownPreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders YAML frontmatter as properties instead of markdown text", () => {
    render(
      <MarkdownPreview
        content={["---", "title: Alpha", "published: true", "---", "# Heading", "Body text"].join("\n")}
      />
    );

    expect(screen.getByText("title")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Heading")).toBeTruthy();
    expect(screen.queryByText(/^---$/)).toBeNull();
  });

  it("shows unsupported frontmatter as raw YAML", () => {
    render(
      <MarkdownPreview content={["---", "seo:", "  title: Alpha", "---", "# Heading"].join("\n")} />
    );

    expect(screen.getByText(/raw yaml/i)).toBeTruthy();
    expect(screen.getByText(/seo:/)).toBeTruthy();
  });
});
