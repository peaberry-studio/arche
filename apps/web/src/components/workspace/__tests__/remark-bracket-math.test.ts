import { describe, expect, it } from "vitest";

import remarkBracketMath from "../remark-bracket-math";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: unknown;
  lang?: string;
};

type ProcessorLike = {
  data: () => Record<string, unknown[]>;
};

function makeProcessor(): ProcessorLike {
  const store: Record<string, unknown[]> = {};
  return {
    data: () => store,
  };
}

function makeParagraph(text: string): MdastNode {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: text }],
      },
    ],
  };
}

function makeCode(text: string): MdastNode {
  return {
    type: "root",
    children: [
      {
        type: "code",
        lang: "javascript",
        value: text,
        children: [{ type: "text", value: text }],
      },
    ],
  };
}

type TransformFn = (tree: MdastNode) => void;

function run(tree: MdastNode): MdastNode {
  const init = remarkBracketMath as unknown as (this: ProcessorLike) => TransformFn;
  const transformer = init.call(makeProcessor());
  transformer(tree);
  return tree;
}

describe("remarkBracketMath transform", () => {
  it("converts bracket inline math to inlineMath node", () => {
    const tree = makeParagraph("hello \\(E = mc^2\\) world");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    const mathNode = children.find((n) => n.type === "inlineMath");

    expect(mathNode).toBeTruthy();
    expect(mathNode?.value).toBe("E = mc^2");
  });

  it("converts bracket display math to math node", () => {
    const tree = makeParagraph("pre \\[\\int_0^1 x\\,dx\\] post");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    const mathNode = children.find((n) => n.type === "math");

    expect(mathNode).toBeTruthy();
    expect(mathNode?.value).toBe("\\int_0^1 x\\,dx");
  });

  it("trims leading and trailing whitespace from the inner value", () => {
    const tree = makeParagraph("\\[\n  a + b\n\\]");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    const mathNode = children.find((n) => n.type === "math");

    expect(mathNode?.value).toBe("a + b");
  });

  it("leaves text without brackets unchanged", () => {
    const tree = makeParagraph("just plain text");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("text");
  });

  it("does not transform text inside a code parent", () => {
    const tree = makeCode("\\(not math\\)");
    run(tree);

    const code = (tree.children as MdastNode[])[0];
    const textChild = (code.children as MdastNode[])[0];
    expect(textChild.type).toBe("text");
    expect(textChild.value).toBe("\\(not math\\)");
  });

  it("handles both inline and display in the same text", () => {
    const tree = makeParagraph("\\[a\\] and \\(b\\)");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    const types = children.map((n) => n.type);
    expect(types).toContain("math");
    expect(types).toContain("inlineMath");
    expect(types).toContain("text");
  });

  it("unescapes unmatched \\( in prose to ( (CommonMark semantics)", () => {
    const tree = makeParagraph("see footnote \\(a and more");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const textNode = (paragraph.children as MdastNode[])[0];
    expect(textNode.type).toBe("text");
    expect(textNode.value).toBe("see footnote (a and more");
  });

  it("unescapes unmatched \\[ in prose to [ (CommonMark semantics)", () => {
    const tree = makeParagraph("an optional \\[flag here");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const textNode = (paragraph.children as MdastNode[])[0];
    expect(textNode.type).toBe("text");
    expect(textNode.value).toBe("an optional [flag here");
  });

  it("unescapes escaped delimiters in the gap between two matches", () => {
    const tree = makeParagraph("\\(a\\) gap \\(b\\)");
    run(tree);

    const paragraph = (tree.children as MdastNode[])[0];
    const children = paragraph.children as MdastNode[];
    const gapNode = children.find(
      (n) => n.type === "text" && n.value?.includes("gap"),
    );
    expect(gapNode?.value).toBe(" gap ");
  });
});
