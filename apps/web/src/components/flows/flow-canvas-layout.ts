import { FLOW_CANVAS_NODE_TYPE_OPTIONS } from '@/lib/flows/node-types'

export type FlowCanvasVisibleBounds = {
  bottom: number
  left: number
  right: number
  top: number
}

export type FlowAddMenuAnchor = {
  x: number
  y: number
}

export type FlowAddMenuPosition = {
  x: number
  y: number
}

export const FLOW_CANVAS_NODE_WIDTH = 156
export const FLOW_CANVAS_NODE_HEIGHT = 56
export const FLOW_ADD_MENU_WIDTH = 104
export const FLOW_ADD_MENU_ITEM_X = 8
export const FLOW_ADD_MENU_ITEM_TOP = 8
export const FLOW_ADD_MENU_ITEM_WIDTH = 88
export const FLOW_ADD_MENU_ITEM_HEIGHT = 22
export const FLOW_ADD_MENU_ITEM_ROW_HEIGHT = 26
export const FLOW_ADD_MENU_BOTTOM_PADDING = 4
export const FLOW_ADD_MENU_DEFAULT_X = FLOW_CANVAS_NODE_WIDTH + 40
export const FLOW_ADD_MENU_DEFAULT_Y = -8
export const FLOW_ADD_MENU_LEFT_GAP = 14
export const FLOW_ADD_MENU_MARGIN = 8

export function getFlowAddMenuHeight(optionCount = FLOW_CANVAS_NODE_TYPE_OPTIONS.length): number {
  return FLOW_ADD_MENU_ITEM_TOP +
    (optionCount - 1) * FLOW_ADD_MENU_ITEM_ROW_HEIGHT +
    FLOW_ADD_MENU_ITEM_HEIGHT +
    FLOW_ADD_MENU_BOTTOM_PADDING
}

export const FLOW_ADD_MENU_HEIGHT = getFlowAddMenuHeight()

function clampToRange(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function getFlowAddMenuPosition(
  anchor: FlowAddMenuAnchor,
  bounds: FlowCanvasVisibleBounds | null,
  optionCount = FLOW_CANVAS_NODE_TYPE_OPTIONS.length,
): FlowAddMenuPosition {
  if (!bounds) {
    return { x: FLOW_ADD_MENU_DEFAULT_X, y: FLOW_ADD_MENU_DEFAULT_Y }
  }

  const minX = bounds.left + FLOW_ADD_MENU_MARGIN - anchor.x
  const maxX = bounds.right - FLOW_ADD_MENU_MARGIN - FLOW_ADD_MENU_WIDTH - anchor.x
  const preferredLeftX = -FLOW_ADD_MENU_WIDTH - FLOW_ADD_MENU_LEFT_GAP
  const preferredX = FLOW_ADD_MENU_DEFAULT_X > maxX ? preferredLeftX : FLOW_ADD_MENU_DEFAULT_X

  const minY = bounds.top + FLOW_ADD_MENU_MARGIN - anchor.y
  const maxY = bounds.bottom - FLOW_ADD_MENU_MARGIN - getFlowAddMenuHeight(optionCount) - anchor.y

  return {
    x: clampToRange(preferredX, minX, maxX),
    y: clampToRange(FLOW_ADD_MENU_DEFAULT_Y, minY, maxY),
  }
}
