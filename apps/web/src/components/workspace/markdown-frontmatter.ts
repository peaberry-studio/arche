import { Document, Pair, YAMLMap, isMap, isScalar, isSeq, parseDocument } from "yaml";

export type MarkdownFrontmatterProperty =
  | {
      key: string;
      type: "string";
      value: string;
    }
  | {
      key: string;
      type: "number";
      value: number;
    }
  | {
      key: string;
      type: "boolean";
      value: boolean;
    }
  | {
      key: string;
      type: "string[]";
      value: string[];
    };

export type ParsedMarkdownFrontmatter = {
  body: string;
  hasFrontmatter: boolean;
  mode: "none" | "raw" | "structured";
  properties: MarkdownFrontmatterProperty[];
  raw: string;
  reason?: "invalid" | "unsupported";
};

type FrontmatterSplitResult = {
  body: string;
  closingFence: "---" | "..." | null;
  hasFrontmatter: boolean;
  raw: string;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function splitMarkdownFrontmatter(value: string): FrontmatterSplitResult {
  const normalized = normalizeLineEndings(value);
  const source = normalized.startsWith("\uFEFF") ? normalized.slice(1) : normalized;
  const lines = source.split("\n");

  if (lines[0] !== "---") {
    return {
      body: normalized,
      closingFence: null,
      hasFrontmatter: false,
      raw: "",
    };
  }

  let endIndex = -1;
  let closingFence: FrontmatterSplitResult["closingFence"] = null;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---" || lines[index] === "...") {
      endIndex = index;
      closingFence = lines[index] === "..." ? "..." : "---";
      break;
    }
  }

  if (endIndex === -1) {
    return {
      body: normalized,
      closingFence: null,
      hasFrontmatter: false,
      raw: "",
    };
  }

  return {
    body: lines.slice(endIndex + 1).join("\n"),
    closingFence,
    hasFrontmatter: true,
    raw: lines.slice(1, endIndex).join("\n"),
  };
}

function parseStructuredProperty(key: string, value: unknown): MarkdownFrontmatterProperty | null {
  if (typeof value === "string") {
    return { key, type: "string", value };
  }

  if (typeof value === "boolean") {
    return { key, type: "boolean", value };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { key, type: "number", value };
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return { key, type: "string[]", value };
  }

  return null;
}

function isSerializableProperty(property: MarkdownFrontmatterProperty): boolean {
  return property.key.trim().length > 0;
}

function stringifyStructuredFrontmatter(properties: MarkdownFrontmatterProperty[]): string {
  const document = new Document();
  const map = new YAMLMap();

  map.items = properties.map((property) => new Pair(property.key, property.value));
  document.contents = map;

  return String(document).trimEnd();
}

export function createEmptyFrontmatterProperty(): MarkdownFrontmatterProperty {
  return {
    key: "",
    type: "string",
    value: "",
  };
}

export function parseMarkdownFrontmatter(value: string): ParsedMarkdownFrontmatter {
  const split = splitMarkdownFrontmatter(value);

  if (!split.hasFrontmatter) {
    return {
      body: split.body,
      hasFrontmatter: false,
      mode: "none",
      properties: [],
      raw: "",
    };
  }

  if (split.raw.trim().length === 0) {
    return {
      body: split.body,
      hasFrontmatter: true,
      mode: "structured",
      properties: [],
      raw: split.raw,
    };
  }

  const document = parseDocument(split.raw, {
    prettyErrors: false,
    strict: false,
  });

  if (document.errors.length > 0) {
    return {
      body: split.body,
      hasFrontmatter: true,
      mode: "raw",
      properties: [],
      raw: split.raw,
      reason: "invalid",
    };
  }

  if (document.contents == null) {
    return {
      body: split.body,
      hasFrontmatter: true,
      mode: "structured",
      properties: [],
      raw: split.raw,
    };
  }

  if (!isMap(document.contents)) {
    return {
      body: split.body,
      hasFrontmatter: true,
      mode: "raw",
      properties: [],
      raw: split.raw,
      reason: "unsupported",
    };
  }

  const properties: MarkdownFrontmatterProperty[] = [];

  for (const item of document.contents.items) {
    const keyNode = item.key;
    if (!isScalar(keyNode) || keyNode.value == null) {
      return {
        body: split.body,
        hasFrontmatter: true,
        mode: "raw",
        properties: [],
        raw: split.raw,
        reason: "unsupported",
      };
    }

    const valueNode = item.value;

    if (valueNode == null) {
      return {
        body: split.body,
        hasFrontmatter: true,
        mode: "raw",
        properties: [],
        raw: split.raw,
        reason: "unsupported",
      };
    }

    if (isScalar(valueNode)) {
      const nextValue = parseStructuredProperty(String(keyNode.value), valueNode.value);
      if (!nextValue) {
        return {
          body: split.body,
          hasFrontmatter: true,
          mode: "raw",
          properties: [],
          raw: split.raw,
          reason: "unsupported",
        };
      }

      properties.push(nextValue);
      continue;
    }

    if (isSeq(valueNode)) {
      const values = valueNode.items.map((entry) => {
        if (!isScalar(entry) || typeof entry.value !== "string") {
          return null;
        }

        return entry.value;
      });

      if (values.some((entry) => entry == null)) {
        return {
          body: split.body,
          hasFrontmatter: true,
          mode: "raw",
          properties: [],
          raw: split.raw,
          reason: "unsupported",
        };
      }

      properties.push({
        key: String(keyNode.value),
        type: "string[]",
        value: values as string[],
      });
      continue;
    }

    return {
      body: split.body,
      hasFrontmatter: true,
      mode: "raw",
      properties: [],
      raw: split.raw,
      reason: "unsupported",
    };
  }

  return {
    body: split.body,
    hasFrontmatter: true,
    mode: "structured",
    properties,
    raw: split.raw,
  };
}

export function serializeMarkdownFrontmatter(
  frontmatter: Pick<ParsedMarkdownFrontmatter, "mode" | "properties" | "raw">,
  body: string
): string {
  const normalizedBody = normalizeLineEndings(body);
  const serializableProperties = frontmatter.properties.filter(isSerializableProperty);

  let rawFrontmatter = "";

  if (frontmatter.mode === "structured") {
    rawFrontmatter =
      serializableProperties.length > 0 ? stringifyStructuredFrontmatter(serializableProperties) : "";
  }

  if (frontmatter.mode === "raw") {
    rawFrontmatter = normalizeLineEndings(frontmatter.raw).replace(/^\n+|\n+$/gu, "");
  }

  if (rawFrontmatter.length === 0) {
    return normalizedBody;
  }

  return `---\n${rawFrontmatter}\n---${normalizedBody.length > 0 ? `\n${normalizedBody}` : "\n"}`;
}

export function replaceMarkdownFrontmatterBody(source: string, body: string): string {
  const split = splitMarkdownFrontmatter(source);
  const normalizedBody = normalizeLineEndings(body);

  if (!split.hasFrontmatter) {
    return normalizedBody;
  }

  const closingFence = split.closingFence ?? "---";

  return `---\n${split.raw}\n${closingFence}${normalizedBody.length > 0 ? `\n${normalizedBody}` : "\n"}`;
}
