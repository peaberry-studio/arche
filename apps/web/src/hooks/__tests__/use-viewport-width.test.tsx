/** @vitest-environment jsdom */

import { render, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SSR_VIEWPORT_WIDTH, useViewportWidth } from "@/hooks/use-viewport-width";

function ViewportProbe() {
  const viewportWidth = useViewportWidth();
  return <div data-testid="viewport-width">{viewportWidth}</div>;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("useViewportWidth", () => {
  it("uses a desktop snapshot during SSR so hydration matches", () => {
    const html = renderToString(<ViewportProbe />);
    expect(html).toContain(String(SSR_VIEWPORT_WIDTH));
  });

  it("reads the live viewport on the client and updates on resize", () => {
    setViewportWidth(1440);
    const { result, rerender } = renderHook(() => useViewportWidth());

    expect(result.current).toBe(1440);

    setViewportWidth(700);
    rerender();

    expect(result.current).toBe(700);
  });

  it("does not reuse the SSR snapshot after a client render", () => {
    setViewportWidth(700);
    const { getByTestId } = render(<ViewportProbe />);
    expect(getByTestId("viewport-width").textContent).toBe("700");
  });
});
