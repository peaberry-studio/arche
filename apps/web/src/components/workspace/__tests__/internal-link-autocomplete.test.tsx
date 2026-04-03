/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternalLinkAutocomplete } from "@/components/workspace/internal-link-autocomplete";

describe("InternalLinkAutocomplete", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders suggestions and emits selected path", () => {
    const onSelect = vi.fn();

    render(
      <InternalLinkAutocomplete
        open
        left={20}
        top={40}
        selectedIndex={0}
        suggestions={[
          { path: "docs/alpha.md", title: "alpha" },
          { path: "docs/beta.md", title: "beta" },
        ]}
        onSelect={onSelect}
      />
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: /beta/i }));
    expect(onSelect).toHaveBeenCalledWith("docs/beta.md");
  });

  it("does not render when closed", () => {
    render(
      <InternalLinkAutocomplete
        open={false}
        left={0}
        top={0}
        selectedIndex={0}
        suggestions={[{ path: "docs/alpha.md", title: "alpha" }]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /alpha/i })).toBeNull();
  });
});
