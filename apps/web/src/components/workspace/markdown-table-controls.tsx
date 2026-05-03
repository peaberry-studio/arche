"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import type { Editor as TiptapEditor } from "@tiptap/react";

import { cn } from "@/lib/utils";

const HOVER_HALO_PX = 24;
// Safety zone around the currently-rendered control buttons. While the cursor is
// inside one, hover state is frozen so the buttons don't jump out from under it
// when the cursor crosses a row/column boundary on its way to the button.
const SAFETY_MARGIN_PX = 20;
// Pill button half-extents — must match the rendered button sizes below.
const H_PILL_HALF_W = 24; // w-12 = 48px
const H_PILL_HALF_H = 10; // h-5  = 20px
const V_PILL_HALF_W = 10; // w-5  = 20px
const V_PILL_HALF_H = 24; // h-12 = 48px

type TableHover = {
  table: HTMLTableElement;
  rect: { left: number; top: number; width: number; height: number };
  rowCount: number;
  colCount: number;
  hoveredRowIndex: number | null;
  hoveredRow: { left: number; top: number; height: number } | null;
  hoveredColumnIndex: number | null;
  hoveredColumn: { left: number; top: number; width: number } | null;
};

type MarkdownTableControlsProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  editor: TiptapEditor | null;
};

function computeRectInContainer(
  container: HTMLElement,
  element: HTMLElement
): { left: number; top: number; width: number; height: number } {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    left: elementRect.left - containerRect.left + container.scrollLeft,
    top: elementRect.top - containerRect.top + container.scrollTop,
    width: elementRect.width,
    height: elementRect.height,
  };
}

export function MarkdownTableControls({ containerRef, editor }: MarkdownTableControlsProps) {
  const [hover, setHover] = useState<TableHover | null>(null);
  const hoverRef = useRef<TableHover | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  const updateHoverFromEvent = useCallback((event: PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const target = event.target;
    // Use Element (not HTMLElement): Phosphor icon paths are SVGElement, and we
    // still need closest() to walk up to the button's data-table-control attr.
    if (!(target instanceof Element)) {
      setHover(null);
      return;
    }

    if (target.closest("[data-table-control]")) {
      // Pointer over a control — keep the current state
      return;
    }

    const table = target.closest<HTMLTableElement>(".workspace-tiptap table");
    if (!table) {
      // Pointer is in the gap between table and out-of-table controls.
      // Keep the current hover alive while cursor stays inside an inflated rect.
      const current = hoverRef.current;
      if (current) {
        const containerRect = container.getBoundingClientRect();
        const cursorX = event.clientX - containerRect.left + container.scrollLeft;
        const cursorY = event.clientY - containerRect.top + container.scrollTop;
        const inside =
          cursorX >= current.rect.left - HOVER_HALO_PX &&
          cursorX <= current.rect.left + current.rect.width + HOVER_HALO_PX &&
          cursorY >= current.rect.top - HOVER_HALO_PX &&
          cursorY <= current.rect.top + current.rect.height + HOVER_HALO_PX;
        if (inside) return;
      }
      setHover(null);
      return;
    }

    const tableRect = computeRectInContainer(container, table);
    const allRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));

    // Detect hovered row/column by cursor position (more stable than target.closest,
    // which flickers at cell boundaries depending on what DOM node is exactly under
    // the pointer).
    const containerRect = container.getBoundingClientRect();
    const cursorX = event.clientX - containerRect.left + container.scrollLeft;
    const cursorY = event.clientY - containerRect.top + container.scrollTop;

    // Freeze hover state while cursor is inside the safety zone of any current
    // control button. This prevents the buttons from jumping when the cursor
    // crosses a row/column boundary to reach them.
    const previous = hoverRef.current;
    if (previous && previous.hoveredRow && previous.hoveredColumn) {
      const colCx = previous.hoveredColumn.left + previous.hoveredColumn.width / 2;
      const colRight = previous.hoveredColumn.left + previous.hoveredColumn.width;
      const colTop = previous.hoveredColumn.top;
      const rowCy = previous.hoveredRow.top + previous.hoveredRow.height / 2;
      const rowBottom = previous.hoveredRow.top + previous.hoveredRow.height;
      const rowLeft = previous.hoveredRow.left;
      const inZone = (
        cx: number,
        cy: number,
        halfW: number,
        halfH: number
      ): boolean =>
        Math.abs(cursorX - cx) <= halfW + SAFETY_MARGIN_PX &&
        Math.abs(cursorY - cy) <= halfH + SAFETY_MARGIN_PX;
      if (
        inZone(colCx, rowBottom, H_PILL_HALF_W, H_PILL_HALF_H) || // + add row
        inZone(colRight, rowCy, V_PILL_HALF_W, V_PILL_HALF_H) || // + add col
        inZone(rowLeft, rowCy, V_PILL_HALF_W, V_PILL_HALF_H) || //  − del row
        inZone(colCx, colTop, H_PILL_HALF_W, H_PILL_HALF_H) //     − del col
      ) {
        return;
      }
    }

    let rowIndex = -1;
    let hoveredRow: { left: number; top: number; height: number } | null = null;
    for (let i = 0; i < allRows.length; i++) {
      const r = computeRectInContainer(container, allRows[i]);
      if (cursorY >= r.top && cursorY <= r.top + r.height) {
        rowIndex = i;
        hoveredRow = { left: r.left, top: r.top, height: r.height };
        break;
      }
    }

    const headerCells = Array.from(allRows[0]?.children ?? []) as HTMLElement[];
    let colIndex = -1;
    let hoveredColumn: { left: number; top: number; width: number } | null = null;
    for (let i = 0; i < headerCells.length; i++) {
      const c = computeRectInContainer(container, headerCells[i]);
      if (cursorX >= c.left && cursorX <= c.left + c.width) {
        colIndex = i;
        hoveredColumn = { left: c.left, top: c.top, width: c.width };
        break;
      }
    }

    const nextRowIndex = rowIndex >= 0 ? rowIndex : null;
    const nextColIndex = colIndex >= 0 ? colIndex : null;

    // Skip the state update when the hovered cell hasn't changed. Avoids
    // re-renders on every mouse twitch within the same cell, which was
    // causing perceptible micro-glitches.
    if (
      previous &&
      previous.table === table &&
      previous.hoveredRowIndex === nextRowIndex &&
      previous.hoveredColumnIndex === nextColIndex
    ) {
      return;
    }

    setHover({
      table,
      rect: tableRect,
      rowCount: allRows.length,
      colCount: allRows[0]?.children.length ?? 0,
      hoveredRowIndex: nextRowIndex,
      hoveredRow,
      hoveredColumnIndex: nextColIndex,
      hoveredColumn,
    });
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerMove = (event: PointerEvent) => updateHoverFromEvent(event);
    const handlePointerLeave = (event: PointerEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && overlayRef.current?.contains(next)) return;
      setHover(null);
    };

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [containerRef, updateHoverFromEvent]);

  const setSelectionToCell = useCallback(
    (cell: HTMLElement | null) => {
      if (!editor || !cell) return false;
      const pos = editor.view.posAtDOM(cell, 0);
      if (pos < 0) return false;
      editor.chain().focus().setTextSelection(pos + 1).run();
      return true;
    },
    [editor]
  );

  const handleAddRow = useCallback(() => {
    if (!editor || !hover) return;
    const targetIndex =
      hover.hoveredRowIndex !== null ? hover.hoveredRowIndex : hover.rowCount - 1;
    const targetRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[targetIndex];
    const cell = targetRow?.children[0] as HTMLElement | undefined;
    if (!setSelectionToCell(cell ?? null)) return;
    editor.chain().focus().addRowAfter().run();
  }, [editor, hover, setSelectionToCell]);

  const handleAddColumn = useCallback(() => {
    if (!editor || !hover) return;
    const targetIndex =
      hover.hoveredColumnIndex !== null ? hover.hoveredColumnIndex : hover.colCount - 1;
    const firstRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[0];
    const cell = firstRow?.children[targetIndex] as HTMLElement | undefined;
    if (!setSelectionToCell(cell ?? null)) return;
    editor.chain().focus().addColumnAfter().run();
  }, [editor, hover, setSelectionToCell]);

  const handleDeleteRow = useCallback(() => {
    if (!editor || !hover || hover.hoveredRowIndex === null) return;
    const targetRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[hover.hoveredRowIndex];
    const cell = targetRow?.children[0] as HTMLElement | undefined;
    if (!setSelectionToCell(cell ?? null)) return;
    editor.chain().focus().deleteRow().run();
  }, [editor, hover, setSelectionToCell]);

  const handleDeleteColumn = useCallback(() => {
    if (!editor || !hover || hover.hoveredColumnIndex === null) return;
    const firstRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[0];
    const cell = firstRow?.children[hover.hoveredColumnIndex] as HTMLElement | undefined;
    if (!setSelectionToCell(cell ?? null)) return;
    editor.chain().focus().deleteColumn().run();
  }, [editor, hover, setSelectionToCell]);

  const overlayStyle = useMemo(() => {
    if (!hover) return undefined;
    return {
      left: hover.rect.left,
      top: hover.rect.top,
      width: hover.rect.width,
      height: hover.rect.height,
    };
  }, [hover]);

  if (!hover || !overlayStyle) return null;

  const canDeleteRow = hover.rowCount > 1 && hover.hoveredRowIndex !== null;
  const canDeleteColumn = hover.colCount > 1 && hover.hoveredColumnIndex !== null;

  // All four controls cluster around the hovered cell:
  //   "+" add row    → bottom edge of hovered row, centered on hovered column X
  //   "+" add column → right edge of hovered column, centered on hovered row Y
  //   "−" del row    → left edge of hovered row, centered on hovered row Y
  //   "−" del column → top edge of hovered column, centered on hovered column X
  const colCenterX = hover.hoveredColumn
    ? hover.hoveredColumn.left - hover.rect.left + hover.hoveredColumn.width / 2
    : hover.rect.width / 2;
  const rowCenterY = hover.hoveredRow
    ? hover.hoveredRow.top - hover.rect.top + hover.hoveredRow.height / 2
    : hover.rect.height / 2;
  const addRowTop = hover.hoveredRow
    ? hover.hoveredRow.top - hover.rect.top + hover.hoveredRow.height
    : hover.rect.height;
  const addColumnLeft = hover.hoveredColumn
    ? hover.hoveredColumn.left - hover.rect.left + hover.hoveredColumn.width
    : hover.rect.width;
  const deleteRowLeft = hover.hoveredRow ? hover.hoveredRow.left - hover.rect.left : 0;
  const deleteColumnTop = hover.hoveredColumn ? hover.hoveredColumn.top - hover.rect.top : 0;

  // cursor-pointer is explicit because the buttons live inside a contenteditable
  // (Tiptap), which otherwise gives them an I-beam cursor by inheritance.
  const hPillCls =
    "pointer-events-auto absolute flex h-5 w-12 cursor-pointer -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-colors";
  const vPillCls =
    "pointer-events-auto absolute flex h-12 w-5 cursor-pointer -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-colors";

  return (
    <div ref={overlayRef} className="pointer-events-none absolute z-10" style={overlayStyle}>
      {/* Add row "+" at the bottom edge of the hovered row, aligned with hovered column */}
      <button
        type="button"
        data-table-control="add-row"
        onClick={handleAddRow}
        aria-label="Add row"
        title="Add row"
        className={cn(hPillCls, "hover:border-primary/40 hover:text-primary")}
        style={{ left: colCenterX, top: addRowTop }}
      >
        <Plus size={11} weight="bold" />
      </button>

      {/* Add column "+" at the right edge of the hovered column, aligned with hovered row */}
      <button
        type="button"
        data-table-control="add-column"
        onClick={handleAddColumn}
        aria-label="Add column"
        title="Add column"
        className={cn(vPillCls, "hover:border-primary/40 hover:text-primary")}
        style={{ left: addColumnLeft, top: rowCenterY }}
      >
        <Plus size={11} weight="bold" />
      </button>

      {/* Delete row "−" at the left edge of the hovered row, mirroring the "+" pill shape */}
      {canDeleteRow && hover.hoveredRow ? (
        <button
          type="button"
          data-table-control="delete-row"
          onClick={handleDeleteRow}
          aria-label="Delete row"
          title="Delete row"
          className={cn(vPillCls, "hover:border-destructive/40 hover:text-destructive")}
          style={{ left: deleteRowLeft, top: rowCenterY }}
        >
          <Minus size={11} weight="bold" />
        </button>
      ) : null}

      {/* Delete column "−" at the top edge of the hovered column, mirroring the "+" pill shape */}
      {canDeleteColumn && hover.hoveredColumn ? (
        <button
          type="button"
          data-table-control="delete-column"
          onClick={handleDeleteColumn}
          aria-label="Delete column"
          title="Delete column"
          className={cn(hPillCls, "hover:border-destructive/40 hover:text-destructive")}
          style={{ left: colCenterX, top: deleteColumnTop }}
        >
          <Minus size={11} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
