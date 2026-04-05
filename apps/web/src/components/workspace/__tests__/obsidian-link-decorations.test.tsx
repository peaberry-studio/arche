/** @vitest-environment jsdom */

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { ObsidianLinkDecorations } from "@/components/workspace/obsidian-link-decorations";

const editors: Editor[] = [];

function createEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      ObsidianLinkDecorations,
      Markdown.configure({
        markedOptions: {
          gfm: true,
        },
      }),
    ],
    content,
    contentType: "markdown",
  });

  editors.push(editor);
  return element;
}

describe("ObsidianLinkDecorations", () => {
  afterEach(() => {
    while (editors.length > 0) {
      editors.pop()?.destroy();
    }

    cleanupDocument();
  });

  it("decorates wikilinks in prose but leaves inline and block code untouched", () => {
    const element = createEditor([
      "See [[docs/alpha.md|Alpha]] in prose.",
      "",
      "`[[docs/inline.md]]`",
      "",
      "```md",
      "[[docs/block.md]]",
      "```",
    ].join("\n"));

    const decoratedLinks = element.querySelectorAll(".kb-internal-link");

    expect(decoratedLinks).toHaveLength(1);
    expect(decoratedLinks[0]?.getAttribute("data-link-target")).toBe("docs/alpha.md|Alpha");
    expect(element.querySelector("code .kb-internal-link")).toBeNull();
    expect(element.querySelector("pre .kb-internal-link")).toBeNull();
  });
});

function cleanupDocument() {
  document.body.innerHTML = "";
}
