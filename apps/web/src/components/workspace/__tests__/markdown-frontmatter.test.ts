import { describe, expect, it } from "vitest";

import {
  parseMarkdownFrontmatter,
  replaceMarkdownFrontmatterBody,
  serializeMarkdownFrontmatter,
} from "@/components/workspace/markdown-frontmatter";

describe("markdown-frontmatter", () => {
  it("parses supported YAML properties into structured fields", () => {
    const parsed = parseMarkdownFrontmatter([
      "---",
      "title: Hello",
      "published: true",
      "rating: 4",
      "tags:",
      "  - alpha",
      "  - beta",
      "---",
      "# Body",
    ].join("\n"));

    expect(parsed).toEqual({
      body: "# Body",
      hasFrontmatter: true,
      mode: "structured",
      properties: [
        { key: "title", type: "string", value: "Hello" },
        { key: "published", type: "boolean", value: true },
        { key: "rating", type: "number", value: 4 },
        { key: "tags", type: "string[]", value: ["alpha", "beta"] },
      ],
      raw: ["title: Hello", "published: true", "rating: 4", "tags:", "  - alpha", "  - beta"].join(
        "\n"
      ),
    });
  });

  it("falls back to raw mode for unsupported nested values", () => {
    const parsed = parseMarkdownFrontmatter(["---", "seo:", "  title: Hello", "---", "# Body"].join("\n"));

    expect(parsed.mode).toBe("raw");
    expect(parsed.reason).toBe("unsupported");
    expect(parsed.raw).toBe(["seo:", "  title: Hello"].join("\n"));
    expect(parsed.body).toBe("# Body");
  });

  it("falls back to raw mode for invalid YAML", () => {
    const parsed = parseMarkdownFrontmatter(["---", "title: [", "---", "# Body"].join("\n"));

    expect(parsed.mode).toBe("raw");
    expect(parsed.reason).toBe("invalid");
  });

  it("serializes structured properties back into frontmatter", () => {
    const serialized = serializeMarkdownFrontmatter(
      {
        mode: "structured",
        properties: [
          { key: "title", type: "string", value: "Hello" },
          { key: "published", type: "boolean", value: true },
          { key: "tags", type: "string[]", value: ["alpha", "beta"] },
        ],
        raw: "",
      },
      "# Body"
    );

    expect(serialized).toBe([
      "---",
      "title: Hello",
      "published: true",
      "tags:",
      "  - alpha",
      "  - beta",
      "---",
      "# Body",
    ].join("\n"));
  });

  it("serializes raw frontmatter without touching the YAML block", () => {
    const serialized = serializeMarkdownFrontmatter(
      {
        mode: "raw",
        properties: [],
        raw: ["seo:", "  title: Hello"].join("\n"),
      },
      "# Body"
    );

    expect(serialized).toBe(["---", "seo:", "  title: Hello", "---", "# Body"].join("\n"));
  });

  it("drops blank structured keys during serialization", () => {
    const serialized = serializeMarkdownFrontmatter(
      {
        mode: "structured",
        properties: [
          { key: "", type: "string", value: "Ignored" },
          { key: "title", type: "string", value: "Hello" },
        ],
        raw: "",
      },
      "# Body"
    );

    expect(serialized).toBe(["---", "title: Hello", "---", "# Body"].join("\n"));
  });

  it("replaces only the markdown body while preserving the original YAML block", () => {
    const serialized = replaceMarkdownFrontmatterBody(
      ["---", 'title: "Hello"', "...", "# Body"].join("\n"),
      "## Updated"
    );

    expect(serialized).toBe(["---", 'title: "Hello"', "...", "## Updated"].join("\n"));
  });
});
