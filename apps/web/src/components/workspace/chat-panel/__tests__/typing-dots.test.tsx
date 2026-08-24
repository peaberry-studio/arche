/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TypingDots } from "@/components/workspace/chat-panel/typing-dots";

describe("TypingDots", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders three dots with staggered animation delays", () => {
    const { container } = render(<TypingDots />);

    const dots = container.querySelectorAll("span.typing-dot");
    expect(dots).toHaveLength(3);
    expect(dots[0].getAttribute("style")).toContain("animation-delay: 0ms");
    expect(dots[1].getAttribute("style")).toContain("animation-delay: 160ms");
    expect(dots[2].getAttribute("style")).toContain("animation-delay: 320ms");
  });

  it("is hidden from assistive technology", () => {
    const { getByTestId } = render(<TypingDots />);

    expect(getByTestId("typing-dots").getAttribute("aria-hidden")).toBe("true");
  });
});
