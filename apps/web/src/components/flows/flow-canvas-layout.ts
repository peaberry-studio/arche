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

export type FlowCanvasContentBounds = {
  height: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  width: number
}

export type FlowCanvasFitTransform = {
  k: number
  x: number
  y: number
}

export type FlowCanvasViewport = {
  height: number
  width: number
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
export const FLOW_CANVAS_FIT_MAX_SCALE = 1
export const FLOW_CANVAS_FIT_MIN_SCALE = 0.2
export const FLOW_CANVAS_FIT_PADDING = 80

export function getFlowAddMenuHeight(optionCount = FLOW_CANVAS_NODE_TYPE_OPTIONS.length): number {
  return FLOW_ADD_MENU_ITEM_TOP +
    (optionCount - 1) * FLOW_ADD_MENU_ITEM_ROW_HEIGHT +
    FLOW_ADD_MENU_ITEM_HEIGHT +
    FLOW_ADD_MENU_BOTTOM_PADDING
}

export function getFlowCanvasContentBounds(
  nodes: ReadonlyArray<{ x: number; y: number }>,
  nodeWidth = FLOW_CANVAS_NODE_WIDTH,
  nodeHeight = FLOW_CANVAS_NODE_HEIGHT,
): FlowCanvasContentBounds | null {
  if (nodes.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + nodeWidth)
    maxY = Math.max(maxY, node.y + nodeHeight)
  }

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

export function getFlowCanvasFitTransform(
  bounds: FlowCanvasContentBounds,
  viewport: FlowCanvasViewport,
  options?: {
    maxScale?: number
    minScale?: number
    padding?: number
  },
): FlowCanvasFitTransform | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null

  const padding = options?.padding ?? FLOW_CANVAS_FIT_PADDING
  const minScale = options?.minScale ?? FLOW_CANVAS_FIT_MIN_SCALE
  const maxScale = options?.maxScale ?? FLOW_CANVAS_FIT_MAX_SCALE
  const availableWidth = Math.max(viewport.width - padding * 2, 1)
  const availableHeight = Math.max(viewport.height - padding * 2, 1)
  const k = Math.max(
    minScale,
    Math.min(
      availableWidth / Math.max(bounds.width, 1),
      availableHeight / Math.max(bounds.height, 1),
      maxScale,
    ),
  )

  return {
    k,
    x: viewport.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k,
    y: viewport.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k,
  }
}

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
