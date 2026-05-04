import { describe, expect, it } from "vitest";

import {
  createEmptyFrontmatterProperty,
  parseMarkdownFrontmatter,
  replaceMarkdownFrontmatterBody,
  serializeMarkdownFrontmatter,
} from "@/components/workspace/markdown-frontmatter";

describe("markdown-frontmatter", () => {
  it("creates a blank string property for new rows", () => {
    expect(createEmptyFrontmatterProperty()).toEqual({ key: "", type: "string", value: "" });
  });

  it("returns none mode when frontmatter is absent or missing a closing fence", () => {
    expect(parseMarkdownFrontmatter("# Body")).toEqual({
      body: "# Body",
      hasFrontmatter: false,
      mode: "none",
      properties: [],
      raw: "",
    });
    expect(parseMarkdownFrontmatter("---\ntitle: Hello\n# Body")).toEqual({
      body: "---\ntitle: Hello\n# Body",
      hasFrontmatter: false,
      mode: "none",
      properties: [],
      raw: "",
    });
  });

  it("normalizes BOM and CRLF line endings with ellipsis closing fences", () => {
    const parsed = parseMarkdownFrontmatter("\uFEFF---\r\ntitle: Hello\r\n...\r\n# Body\r\n");

    expect(parsed).toEqual({
      body: "# Body\n",
      hasFrontmatter: true,
      mode: "structured",
      properties: [{ key: "title", type: "string", value: "Hello" }],
      raw: "title: Hello",
    });
  });

  it("parses empty frontmatter as structured with no properties", () => {
    expect(parseMarkdownFrontmatter(["---", "---", "# Body"].join("\n"))).toEqual({
      body: "# Body",
      hasFrontmatter: true,
      mode: "structured",
      properties: [],
      raw: "",
    });
  });

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

  it.each([
    [["---", "- title", "---", "# Body"].join("\n")],
    [["---", "title:", "---", "# Body"].join("\n")],
    [["---", "tags:", "  - alpha", "  - 1", "---", "# Body"].join("\n")],
  ])("falls back to raw mode for unsupported YAML shapes", (source) => {
    const parsed = parseMarkdownFrontmatter(source);

    expect(parsed.mode).toBe("raw");
    expect(parsed.reason).toBe("unsupported");
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

  it("serializes empty structured frontmatter as body only", () => {
    const serialized = serializeMarkdownFrontmatter(
      {
        mode: "structured",
        properties: [],
        raw: "",
      },
      "# Body\r\nNext"
    );

    expect(serialized).toBe("# Body\nNext");
  });

  it("trims surrounding raw frontmatter blank lines and keeps empty bodies valid", () => {
    const serialized = serializeMarkdownFrontmatter(
      {
        mode: "raw",
        properties: [],
        raw: "\nseo:\n  title: Hello\n",
      },
      ""
    );

    expect(serialized).toBe(["---", "seo:", "  title: Hello", "---", ""].join("\n"));
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

  it("replaces body content without frontmatter and with empty replacement bodies", () => {
    expect(replaceMarkdownFrontmatterBody("# Old", "# New\r\nNext")).toBe("# New\nNext");
    expect(replaceMarkdownFrontmatterBody(["---", "title: Hello", "---", "# Body"].join("\n"), "")).toBe(
      ["---", "title: Hello", "---", ""].join("\n")
    );
  });
});
