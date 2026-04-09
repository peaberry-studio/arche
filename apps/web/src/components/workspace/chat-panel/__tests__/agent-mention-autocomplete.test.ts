import { describe, expect, it } from "vitest";

import { getAgentMentionAutocompletePosition } from "@/lib/workspace-agent-mentions";

describe("getAgentMentionAutocompletePosition", () => {
  it("renders below the caret when there is not enough room above", () => {
    expect(
      getAgentMentionAutocompletePosition({
        anchorLeft: 24,
        anchorTop: 18,
        popoverWidth: 220,
        popoverHeight: 160,
        viewportWidth: 800,
        viewportHeight: 600,
      })
    ).toEqual({
      left: 24,
      top: 26,
      placement: "bottom",
    });
  });

  it("renders above the caret when there is not enough room below", () => {
    expect(
      getAgentMentionAutocompletePosition({
        anchorLeft: 24,
        anchorTop: 560,
        popoverWidth: 220,
        popoverHeight: 160,
        viewportWidth: 800,
        viewportHeight: 600,
      })
    ).toEqual({
      left: 24,
      top: 392,
      placement: "top",
    });
  });

  it("clamps the popover inside the viewport when space is tight", () => {
    expect(
      getAgentMentionAutocompletePosition({
        anchorLeft: 500,
        anchorTop: 15,
        popoverWidth: 200,
        popoverHeight: 140,
        viewportWidth: 640,
        viewportHeight: 170,
      })
    ).toEqual({
      left: 428,
      top: 18,
      placement: "bottom",
    });
  });
});
