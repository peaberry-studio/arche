import { describe, expect, it } from "vitest";

import {
  buildInternalLinkSuggestions,
  findObsidianAutocompleteMatch,
  findObsidianLinks,
  findObsidianLinkAt,
  getObsidianLinkDisplayLabel,
  getObsidianLinkFullPath,
  resolveObsidianLinkTarget,
} from "@/lib/kb-internal-links";

describe("findObsidianLinkAt", () => {
  it("returns link bounds and target at offset inside link", () => {
    const content = "Go to [[docs/alpha.md|Alpha Doc]] now";
    const link = findObsidianLinkAt(content, 10);

    expect(link).toEqual({
      from: 6,
      to: 33,
      target: "docs/alpha.md|Alpha Doc",
    });
  });

  it("returns null when offset is outside any obsidian link", () => {
    const content = "Go to [[docs/alpha.md]] now";
    expect(findObsidianLinkAt(content, 1)).toBeNull();
  });
});

describe("findObsidianLinks", () => {
  it("finds all obsidian links in content", () => {
    const links = findObsidianLinks("See [[alpha]] and [[docs/beta.md|Beta]]");

    expect(links).toEqual([
      { from: 4, to: 13, target: "alpha" },
      { from: 18, to: 39, target: "docs/beta.md|Beta" },
    ]);
  });
});

describe("resolveObsidianLinkTarget", () => {
  const files = ["docs/alpha.md", "docs/sub/beta.md", "README.md"];

  it("resolves full markdown path", () => {
    expect(resolveObsidianLinkTarget("docs/alpha.md", files)).toBe("docs/alpha.md");
  });

  it("resolves path without extension", () => {
    expect(resolveObsidianLinkTarget("docs/sub/beta", files)).toBe("docs/sub/beta.md");
  });

  it("resolves alias and heading targets", () => {
    expect(resolveObsidianLinkTarget("docs/sub/beta#Section|Beta", files)).toBe("docs/sub/beta.md");
  });
});

describe("obsidian link display helpers", () => {
  it("uses alias as display label when present", () => {
    expect(getObsidianLinkDisplayLabel("docs/sub/beta.md|Beta Doc")).toBe("Beta Doc");
  });

  it("falls back to basename without extension when no alias exists", () => {
    expect(getObsidianLinkDisplayLabel("docs/sub/beta.md#Overview")).toBe("beta");
  });

  it("returns full normalized path without alias for hover metadata", () => {
    expect(getObsidianLinkFullPath("./docs/sub/beta.md#Overview|Beta Doc")).toBe(
      "docs/sub/beta.md#Overview"
    );
  });
});

describe("findObsidianAutocompleteMatch", () => {
  it("detects query after [[", () => {
    const result = findObsidianAutocompleteMatch("something [[do");
    expect(result).toEqual({
      query: "do",
      from: 10,
      to: 14,
    });
  });

  it("returns null when no active wikilink prefix", () => {
    expect(findObsidianAutocompleteMatch("something [do")).toBeNull();
  });
});

describe("buildInternalLinkSuggestions", () => {
  it("prioritizes title-prefix matches and strips .md in title", () => {
    const suggestions = buildInternalLinkSuggestions(
      ["docs/design-doc.md", "notes/today.md", "README.md"],
      "de"
    );

    expect(suggestions[0]).toEqual({ path: "docs/design-doc.md", title: "design-doc" });
  });

  it("returns default suggestions when query is empty", () => {
    const suggestions = buildInternalLinkSuggestions(["b.md", "a.md"], "");
    expect(suggestions.map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
  });
});
