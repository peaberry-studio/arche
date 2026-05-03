"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import type { Editor as TiptapEditor } from "@tiptap/react";

import { cn } from "@/lib/utils";

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
  const overlayRef = useRef<HTMLDivElement>(null);

  const updateHoverFromEvent = useCallback((event: PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      setHover(null);
      return;
    }

    if (target.closest("[data-table-control]")) {
      // Pointer over a control — keep the current state
      return;
    }

    const table = target.closest<HTMLTableElement>(".workspace-tiptap table");
    if (!table) {
      setHover(null);
      return;
    }

    const cell = target.closest<HTMLTableCellElement>("th, td");
    const row = cell?.parentElement instanceof HTMLTableRowElement ? cell.parentElement : null;
    const tableRect = computeRectInContainer(container, table);

    const allRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));
    const rowIndex = row ? allRows.indexOf(row) : -1;
    const colIndex = cell ? cell.cellIndex : -1;

    const hoveredRow =
      row && rowIndex >= 0
        ? (() => {
            const r = computeRectInContainer(container, row);
            return { left: r.left, top: r.top, height: r.height };
          })()
        : null;

    const hoveredColumn =
      cell && colIndex >= 0
        ? (() => {
            const headerRow = allRows[0];
            const headerCell = headerRow?.children[colIndex] as HTMLElement | undefined;
            const referenceCell = headerCell ?? cell;
            const r = computeRectInContainer(container, referenceCell);
            return { left: r.left, top: r.top, width: r.width };
          })()
        : null;

    setHover({
      table,
      rect: tableRect,
      rowCount: allRows.length,
      colCount: allRows[0]?.children.length ?? 0,
      hoveredRowIndex: rowIndex >= 0 ? rowIndex : null,
      hoveredRow,
      hoveredColumnIndex: colIndex >= 0 ? colIndex : null,
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
    const lastRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[hover.rowCount - 1];
    const lastCell = lastRow?.children[0] as HTMLElement | undefined;
    if (!setSelectionToCell(lastCell ?? null)) return;
    editor.chain().focus().addRowAfter().run();
  }, [editor, hover, setSelectionToCell]);

  const handleAddColumn = useCallback(() => {
    if (!editor || !hover) return;
    const firstRow = hover.table.querySelectorAll<HTMLTableRowElement>("tr")[0];
    const lastCell = firstRow?.children[hover.colCount - 1] as HTMLElement | undefined;
    if (!setSelectionToCell(lastCell ?? null)) return;
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

  return (
    <div ref={overlayRef} className="pointer-events-none absolute z-10" style={overlayStyle}>
      {/* Add row "+" at the bottom edge of the table */}
      <button
        type="button"
        data-table-control="add-row"
        onClick={handleAddRow}
        aria-label="Add row"
        title="Add row"
        className={cn(
          "pointer-events-auto absolute left-1/2 flex h-5 w-12 -translate-x-1/2 items-center justify-center rounded-md border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-all hover:border-primary/40 hover:text-primary"
        )}
        style={{ top: hover.rect.height - 2 }}
      >
        <Plus size={11} weight="bold" />
      </button>

      {/* Add column "+" at the right edge of the table */}
      <button
        type="button"
        data-table-control="add-column"
        onClick={handleAddColumn}
        aria-label="Add column"
        title="Add column"
        className={cn(
          "pointer-events-auto absolute top-1/2 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-md border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-all hover:border-primary/40 hover:text-primary"
        )}
        style={{ left: hover.rect.width - 2 }}
      >
        <Plus size={11} weight="bold" />
      </button>

      {/* Delete row "−" on the left edge of the hovered row */}
      {canDeleteRow && hover.hoveredRow ? (
        <button
          type="button"
          data-table-control="delete-row"
          onClick={handleDeleteRow}
          aria-label="Delete row"
          title="Delete row"
          className="pointer-events-auto absolute flex h-4 w-4 items-center justify-center rounded-full border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-all hover:border-destructive/40 hover:text-destructive"
          style={{
            left: hover.hoveredRow.left - hover.rect.left - 18,
            top: hover.hoveredRow.top - hover.rect.top + hover.hoveredRow.height / 2 - 8,
          }}
        >
          <Minus size={9} weight="bold" />
        </button>
      ) : null}

      {/* Delete column "−" above the hovered column */}
      {canDeleteColumn && hover.hoveredColumn ? (
        <button
          type="button"
          data-table-control="delete-column"
          onClick={handleDeleteColumn}
          aria-label="Delete column"
          title="Delete column"
          className="pointer-events-auto absolute flex h-4 w-4 items-center justify-center rounded-full border border-border/40 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-all hover:border-destructive/40 hover:text-destructive"
          style={{
            left: hover.hoveredColumn.left - hover.rect.left + hover.hoveredColumn.width / 2 - 8,
            top: hover.hoveredColumn.top - hover.rect.top - 18,
          }}
        >
          <Minus size={9} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
