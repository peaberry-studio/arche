type ObsidianLinkBounds = {
  from: number;
  to: number;
  target: string;
};

const OBSIDIAN_LINK_REGEX = /\[\[([^\]\n]+)\]\]/g;

type InternalLinkSuggestion = {
  path: string;
  title: string;
};

type ParsedObsidianLinkTarget = {
  alias: string | null;
  fullPath: string;
  path: string;
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function stripMarkdownExtension(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

function normalizeLookupKey(path: string): string {
  return stripMarkdownExtension(normalizePath(path)).toLowerCase();
}

function parseTarget(rawTarget: string): string {
  const [beforeAlias] = rawTarget.split("|");
  const [beforeHeading] = beforeAlias.split("#");
  return normalizePath(beforeHeading.trim());
}

function parseObsidianLinkTarget(rawTarget: string): ParsedObsidianLinkTarget {
  const [rawPathWithHeading, rawAlias] = rawTarget.split("|");
  const fullPath = normalizePath(rawPathWithHeading.trim());
  const alias = rawAlias?.trim() ? rawAlias.trim() : null;

  return {
    alias,
    fullPath,
    path: parseTarget(rawTarget),
  };
}

export function findObsidianLinkAt(content: string, offset: number): ObsidianLinkBounds | null {
  if (!content) return null;
  if (offset < 0 || offset > content.length) return null;

  const start = content.lastIndexOf("[[", offset);
  if (start < 0) return null;

  const end = content.indexOf("]]", start + 2);
  if (end < 0) return null;
  if (offset > end + 2) return null;

  const target = content.slice(start + 2, end).trim();
  if (!target) return null;

  return {
    from: start,
    to: end + 2,
    target,
  };
}

export function findObsidianLinks(content: string): ObsidianLinkBounds[] {
  if (!content) return [];

  const links: ObsidianLinkBounds[] = [];
  const matches = content.matchAll(OBSIDIAN_LINK_REGEX);
  for (const match of matches) {
    if (typeof match.index !== "number") continue;
    const full = match[0];
    const target = match[1].trim();
    if (!target) continue;

    links.push({
      from: match.index,
      to: match.index + full.length,
      target,
    });
  }

  return links;
}

export function resolveObsidianLinkTarget(
  rawTarget: string,
  availablePaths: string[]
): string | null {
  const parsedTarget = parseObsidianLinkTarget(rawTarget).path;
  if (!parsedTarget) return null;

  const normalizedAvailable = availablePaths.map((path) => normalizePath(path));
  const exactMatch = normalizedAvailable.find((path) => normalizeLookupKey(path) === normalizeLookupKey(parsedTarget));
  if (exactMatch) return exactMatch;

  const suffixMatch = normalizedAvailable
    .filter((path) => {
      const normalizedPath = normalizeLookupKey(path);
      const normalizedTarget = normalizeLookupKey(parsedTarget);
      return normalizedPath.endsWith(`/${normalizedTarget}`) || normalizedPath === normalizedTarget;
    })
    .sort((left, right) => right.length - left.length);

  return suffixMatch[0] ?? null;
}

export function getObsidianLinkDisplayLabel(rawTarget: string): string {
  const parsed = parseObsidianLinkTarget(rawTarget);
  if (parsed.alias) return parsed.alias;

  const basename = parsed.path.split("/").pop() ?? parsed.path;
  const label = stripMarkdownExtension(basename);
  return label || parsed.fullPath || rawTarget.trim();
}

export function getObsidianLinkFullPath(rawTarget: string): string {
  const parsed = parseObsidianLinkTarget(rawTarget);
  return parsed.fullPath || rawTarget.trim();
}

export function findObsidianAutocompleteMatch(contentBeforeCursor: string): {
  query: string;
  from: number;
  to: number;
} | null {
  const match = /\[\[([^\]\n]*)$/.exec(contentBeforeCursor);
  if (!match) return null;

  const from = contentBeforeCursor.length - match[0].length;
  return {
    query: match[1].trimStart(),
    from,
    to: contentBeforeCursor.length,
  };
}

export function buildInternalLinkSuggestions(
  availablePaths: string[],
  rawQuery: string,
  limit = 8
): InternalLinkSuggestion[] {
  const query = rawQuery.trim().toLowerCase();

  return availablePaths
    .map((path) => normalizePath(path))
    .filter((path) => path.length > 0)
    .filter((path, index, arr) => arr.indexOf(path) === index)
    .map((path) => {
      const basename = path.split("/").pop() ?? path;
      const withoutExtension = stripMarkdownExtension(basename);
      return {
        path,
        title: withoutExtension,
        score: query.length === 0
          ? 1
          : withoutExtension.toLowerCase().startsWith(query)
            ? 4
            : path.toLowerCase().startsWith(query)
              ? 3
              : withoutExtension.toLowerCase().includes(query)
                ? 2
                : path.toLowerCase().includes(query)
                  ? 1
                  : 0,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.title.length !== right.title.length) return left.title.length - right.title.length;
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit)
    .map(({ path, title }) => ({ path, title }));
}

export type { InternalLinkSuggestion };
