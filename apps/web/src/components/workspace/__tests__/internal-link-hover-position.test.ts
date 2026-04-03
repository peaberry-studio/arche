import { describe, expect, it } from "vitest";

import { getInternalLinkHoverPosition } from "@/components/workspace/internal-link-hover-position";

describe("getInternalLinkHoverPosition", () => {
  it("places the bubble below when there is enough room", () => {
    const position = getInternalLinkHoverPosition({
      anchorBottom: 160,
      anchorLeft: 180,
      anchorTop: 140,
      scrollerClientHeight: 400,
      scrollerClientWidth: 600,
      scrollerLeft: 50,
      scrollerScrollLeft: 0,
      scrollerScrollTop: 0,
      scrollerTop: 100,
    });

    expect(position).toEqual({
      left: 130,
      placement: "below",
      top: 68,
    });
  });

  it("places the bubble above when the bottom edge lacks room", () => {
    const position = getInternalLinkHoverPosition({
      anchorBottom: 440,
      anchorLeft: 220,
      anchorTop: 420,
      scrollerClientHeight: 400,
      scrollerClientWidth: 600,
      scrollerLeft: 50,
      scrollerScrollLeft: 0,
      scrollerScrollTop: 0,
      scrollerTop: 100,
    });

    expect(position).toEqual({
      left: 170,
      placement: "above",
      top: 240,
    });
  });

  it("clamps the bubble within the visible scroller bounds", () => {
    const position = getInternalLinkHoverPosition({
      anchorBottom: 150,
      anchorLeft: 470,
      anchorTop: 130,
      scrollerClientHeight: 220,
      scrollerClientWidth: 360,
      scrollerLeft: 100,
      scrollerScrollLeft: 24,
      scrollerScrollTop: 40,
      scrollerTop: 80,
    });

    expect(position).toEqual({
      left: 88,
      placement: "below",
      top: 118,
    });
  });
});
