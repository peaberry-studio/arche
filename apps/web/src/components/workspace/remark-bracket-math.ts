import { visit, SKIP } from "unist-util-visit";

type TextChild = { type: "text"; value: string };

type MathReplacementNode = {
  type: "math" | "inlineMath";
  value: string;
  children: TextChild[];
  data: {
    hName: string;
    hProperties?: { className: string[] };
    hChildren: unknown[];
  };
};

type ReplacementNode = TextChild | MathReplacementNode;

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
};

const SKIP_PARENT_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "math",
  "inlineMath",
]);

const DISPLAY_MATH_RE = /\\\[([\s\S]+?)\\\]/g;
const INLINE_MATH_RE = /\\\(([\s\S]+?)\\\)/g;

function trimOuter(value: string): string {
  return value.replace(/^\s+|\s+$/g, "");
}

type Effects = {
  enter: (type: string) => void;
  exit: (type: string) => void;
  consume: (code: number) => void;
};

type State = (code: number | null) => State | undefined;

function tokenizeBracketMath(
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let closeChar = 0;

  return start;

  function start(code: number | null): State | undefined {
    if (code === null) return nok(code);
    effects.enter("data");
    effects.consume(code);
    return afterBackslash;
  }

  function afterBackslash(code: number | null): State | undefined {
    if (code === null) return nok(code);
    if (code === 91) {
      closeChar = 93;
      effects.consume(code);
      return inMath;
    }
    if (code === 40) {
      closeChar = 41;
      effects.consume(code);
      return inMath;
    }
    return nok(code);
  }

  function inMath(code: number | null): State | undefined {
    if (code === null) return nok(code);
    if (code === 92) {
      effects.consume(code);
      return checkClose;
    }
    effects.consume(code);
    return inMath;
  }

  function checkClose(code: number | null): State | undefined {
    if (code === null) return nok(code);
    if (code === closeChar) {
      effects.consume(code);
      effects.exit("data");
      return ok(code);
    }
    effects.consume(code);
    return inMath;
  }
}

const bracketMathExtension = {
  text: {
    [92]: {
      name: "bracketMath",
      tokenize: tokenizeBracketMath,
    },
  },
};

function buildReplacement(text: string): ReplacementNode[] | null {
  type Match = {
    start: number;
    end: number;
    value: string;
    type: "math" | "inlineMath";
  };
  const matches: Match[] = [];

  let m: RegExpExecArray | null;
  DISPLAY_MATH_RE.lastIndex = 0;
  while ((m = DISPLAY_MATH_RE.exec(text)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      value: trimOuter(m[1]),
      type: "math",
    });
  }
  const displayRanges = matches.map((mm) => ({
    start: mm.start,
    end: mm.end,
  }));

  INLINE_MATH_RE.lastIndex = 0;
  while ((m = INLINE_MATH_RE.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlaps = displayRanges.some(
      (r) => start < r.end && end > r.start,
    );
    if (!overlaps) {
      matches.push({
        start,
        end,
        value: trimOuter(m[1]),
        type: "inlineMath",
      });
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.start - b.start);

  const nodes: ReplacementNode[] = [];
  let cursor = 0;
  for (const mm of matches) {
    if (mm.start > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, mm.start) });
    }
    if (mm.type === "math") {
      nodes.push({
        type: "math",
        value: mm.value,
        children: [{ type: "text", value: mm.value }],
        data: {
          hName: "pre",
          hChildren: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-math", "math-display"] },
              children: [{ type: "text", value: mm.value }],
            },
          ],
        },
      });
    } else {
      nodes.push({
        type: "inlineMath",
        value: mm.value,
        children: [{ type: "text", value: mm.value }],
        data: {
          hName: "code",
          hProperties: { className: ["language-math", "math-inline"] },
          hChildren: [{ type: "text", value: mm.value }],
        },
      });
    }
    cursor = mm.end;
  }
  if (cursor < text.length) {
    nodes.push({ type: "text", value: text.slice(cursor) });
  }

  return nodes;
}

export default function remarkBracketMath(this: unknown) {
  const self = this as { data: () => Record<string, unknown> };
  const data = self.data();
  const existing = data.micromarkExtensions;
  if (Array.isArray(existing)) {
    existing.push(bracketMathExtension);
  } else {
    data.micromarkExtensions = [bracketMathExtension];
  }

  return (tree: MdastNode) => {
    visit(tree, (node: MdastNode, index, parent) => {
      if (node.type !== "text") return;
      const typedParent = parent as MdastNode | undefined;
      if (!typedParent || index === undefined) return;
      if (SKIP_PARENT_TYPES.has(typedParent.type)) return;
      if (!Array.isArray(typedParent.children)) return;
      if (typeof node.value !== "string") return;

      const replacement = buildReplacement(node.value);
      if (!replacement) return;

      typedParent.children.splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
}
