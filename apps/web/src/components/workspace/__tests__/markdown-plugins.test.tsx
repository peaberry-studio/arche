/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ReactMarkdown from "react-markdown";

import {
  workspaceRehypePlugins,
  workspaceRemarkPlugins,
} from "../markdown-plugins";

afterEach(() => {
  cleanup();
});

describe("markdown math rendering", () => {
  it("renders display math with katex-display class", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"$$\nT_{CPU} = \\frac{32\\ GiB}{455\\ MB/s} \\approx 75\\ s\n$$"}
      </ReactMarkdown>,
    );

    const display = container.querySelector(".katex-display");
    expect(display).toBeTruthy();
  });

  it("renders inline math with katex class inside a paragraph", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"$a^2 + b^2 = c^2$"}
      </ReactMarkdown>,
    );

    const p = container.querySelector("p");
    expect(p).toBeTruthy();
    const katex = p?.querySelector(".katex");
    expect(katex).toBeTruthy();
    expect(katex?.classList.contains("katex-display")).toBe(false);
  });

  it("renders bracket display math with katex-display class", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"\\[\\int_0^1 x\\,dx = \\tfrac12\\]"}
      </ReactMarkdown>,
    );

    const display = container.querySelector(".katex-display");
    expect(display).toBeTruthy();
  });

  it("renders bracket inline math with katex class", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"\\(E = mc^2\\)"}
      </ReactMarkdown>,
    );

    const katex = container.querySelector(".katex");
    expect(katex).toBeTruthy();
    expect(katex?.classList.contains("katex-display")).toBe(false);
  });

  it("does not throw on invalid TeX and renders fallback", () => {
    let threw = false;
    let container: HTMLElement | undefined;

    try {
      const result = render(
        <ReactMarkdown
          remarkPlugins={workspaceRemarkPlugins}
          rehypePlugins={workspaceRehypePlugins}
        >
          {"$$\\frac{1$$"}
        </ReactMarkdown>,
      );
      container = result.container;
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    const fallback = container?.querySelector(".katex, .katex-error");
    expect(fallback).toBeTruthy();
  });

  it("does not render math inside fenced code blocks", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"```js\nconst x = $not math$\n```"}
      </ReactMarkdown>,
    );

    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    const code = pre?.querySelector("code");
    expect(code?.textContent).toContain("$not math$");
    expect(pre?.querySelector(".katex")).toBeNull();
  });

  it("does not render math inside inline code", () => {
    const { container } = render(
      <ReactMarkdown
        remarkPlugins={workspaceRemarkPlugins}
        rehypePlugins={workspaceRehypePlugins}
      >
        {"`\\frac{1}{2}`"}
      </ReactMarkdown>,
    );

    const code = container.querySelector("code");
    expect(code?.textContent).toContain("\\frac{1}{2}");
    expect(code?.querySelector(".katex")).toBeNull();
  });
});
