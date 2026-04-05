type InternalLinkHoverPositionArgs = {
  anchorBottom: number;
  anchorLeft: number;
  anchorTop: number;
  bubbleHeight?: number;
  bubbleWidth?: number;
  gap?: number;
  padding?: number;
  scrollerClientHeight: number;
  scrollerClientWidth: number;
  scrollerLeft: number;
  scrollerScrollLeft: number;
  scrollerScrollTop: number;
  scrollerTop: number;
};

type InternalLinkHoverPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
};

const DEFAULT_BUBBLE_WIDTH_PX = 288;
const DEFAULT_BUBBLE_HEIGHT_PX = 72;
const DEFAULT_GAP_PX = 8;
const DEFAULT_PADDING_PX = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getInternalLinkHoverPosition({
  anchorBottom,
  anchorLeft,
  anchorTop,
  bubbleHeight = DEFAULT_BUBBLE_HEIGHT_PX,
  bubbleWidth = DEFAULT_BUBBLE_WIDTH_PX,
  gap = DEFAULT_GAP_PX,
  padding = DEFAULT_PADDING_PX,
  scrollerClientHeight,
  scrollerClientWidth,
  scrollerLeft,
  scrollerScrollLeft,
  scrollerScrollTop,
  scrollerTop,
}: InternalLinkHoverPositionArgs): InternalLinkHoverPosition {
  const availableBelow = scrollerTop + scrollerClientHeight - anchorBottom - padding;
  const availableAbove = anchorTop - scrollerTop - padding;
  const placement =
    availableBelow >= bubbleHeight + gap || availableBelow >= availableAbove ? "below" : "above";

  const preferredLeft = anchorLeft - scrollerLeft + scrollerScrollLeft;
  const minLeft = scrollerScrollLeft + padding;
  const maxLeft = scrollerScrollLeft + Math.max(padding, scrollerClientWidth - bubbleWidth - padding);

  const preferredTop =
    placement === "below"
      ? anchorBottom - scrollerTop + scrollerScrollTop + gap
      : anchorTop - scrollerTop + scrollerScrollTop - bubbleHeight - gap;

  const minTop = scrollerScrollTop + padding;
  const maxTop = scrollerScrollTop + Math.max(padding, scrollerClientHeight - bubbleHeight - padding);

  return {
    left: clamp(preferredLeft, minLeft, maxLeft),
    placement,
    top: clamp(preferredTop, minTop, maxTop),
  };
}

export type { InternalLinkHoverPosition, InternalLinkHoverPositionArgs };
