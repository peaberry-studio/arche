/** @vitest-environment jsdom */

import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownTableControls } from "@/components/workspace/markdown-table-controls";

const chain = {
  addColumnAfter: vi.fn(() => chain),
  addRowAfter: vi.fn(() => chain),
  deleteColumn: vi.fn(() => chain),
  deleteRow: vi.fn(() => chain),
  focus: vi.fn(() => chain),
  run: vi.fn(() => true),
  setTextSelection: vi.fn(() => chain),
};

function TableControlsHarness({ editor, singleCell = false }: { editor: TiptapEditor | null; singleCell?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} data-testid="table-container" className="relative h-80 w-80 overflow-auto">
      <div className="workspace-tiptap">
        <table>
          <tbody>
            {singleCell ? (
              <tr>
                <td>Alpha</td>
              </tr>
            ) : (
              <>
                <tr>
                  <td>Alpha</td>
                  <td>Beta</td>
                </tr>
                <tr>
                  <td>Gamma</td>
                  <td>Delta</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <MarkdownTableControls containerRef={containerRef} editor={editor} />
    </div>
  );
}

function stubRect(element: Element, left: number, top: number, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(left, top, width, height),
  });
}

describe("MarkdownTableControls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows hovered table controls and dispatches row and column commands", async () => {
    const editor = {
      chain: () => chain,
      view: {
        posAtDOM: vi.fn(() => 3),
      },
    } as unknown as TiptapEditor;

    render(<TableControlsHarness editor={editor} />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const rows = Array.from(container.querySelectorAll("tr"));
    const cells = Array.from(container.querySelectorAll("td"));

    if (!table || rows.length !== 2 || cells.length !== 4) {
      throw new Error("Expected a 2x2 table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 200, 100);
    stubRect(rows[0], 40, 40, 200, 50);
    stubRect(rows[1], 40, 90, 200, 50);
    stubRect(cells[0], 40, 40, 100, 50);
    stubRect(cells[1], 140, 40, 100, 50);
    stubRect(cells[2], 40, 90, 100, 50);
    stubRect(cells[3], 140, 90, 100, 50);

    fireEvent.pointerMove(cells[0], { clientX: 70, clientY: 65 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();
    });

    fireEvent.pointerMove(cells[0], { clientX: 80, clientY: 70 });
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete row" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete column" }));

    expect(chain.addRowAfter).toHaveBeenCalledTimes(1);
    expect(chain.addColumnAfter).toHaveBeenCalledTimes(1);
    expect(chain.deleteRow).toHaveBeenCalledTimes(1);
    expect(chain.deleteColumn).toHaveBeenCalledTimes(1);
    expect(chain.setTextSelection).toHaveBeenCalledWith(4);
  });

  it("keeps add controls for a single-cell table without delete controls", async () => {
    render(<TableControlsHarness editor={null} singleCell />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const row = container.querySelector("tr");
    const cell = container.querySelector("td");

    if (!table || !row || !cell) {
      throw new Error("Expected a single-cell table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 100, 50);
    stubRect(row, 40, 40, 100, 50);
    stubRect(cell, 40, 40, 100, 50);

    fireEvent.pointerMove(cell, { clientX: 70, clientY: 65 });

    expect(await screen.findByRole("button", { name: "Add row" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add column" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete row" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete column" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));

    expect(chain.addRowAfter).not.toHaveBeenCalled();
    expect(chain.addColumnAfter).not.toHaveBeenCalled();
  });

  it("skips table commands when the editor cannot resolve a cell position", async () => {
    const editor = {
      chain: () => chain,
      view: {
        posAtDOM: vi.fn(() => -1),
      },
    } as unknown as TiptapEditor;

    render(<TableControlsHarness editor={editor} />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const rows = Array.from(container.querySelectorAll("tr"));
    const cells = Array.from(container.querySelectorAll("td"));

    if (!table || rows.length !== 2 || cells.length !== 4) {
      throw new Error("Expected a 2x2 table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 200, 100);
    stubRect(rows[0], 40, 40, 200, 50);
    stubRect(rows[1], 40, 90, 200, 50);
    stubRect(cells[0], 40, 40, 100, 50);
    stubRect(cells[1], 140, 40, 100, 50);
    stubRect(cells[2], 40, 90, 100, 50);
    stubRect(cells[3], 140, 90, 100, 50);

    fireEvent.pointerMove(cells[0], { clientX: 70, clientY: 65 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete row" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete column" }));

    expect(chain.setTextSelection).not.toHaveBeenCalled();
    expect(chain.addRowAfter).not.toHaveBeenCalled();
    expect(chain.addColumnAfter).not.toHaveBeenCalled();
    expect(chain.deleteRow).not.toHaveBeenCalled();
    expect(chain.deleteColumn).not.toHaveBeenCalled();
  });

  it("clears controls when the pointer leaves the table halo", async () => {
    const editor = {
      chain: () => chain,
      view: {
        posAtDOM: vi.fn(() => 3),
      },
    } as unknown as TiptapEditor;

    render(<TableControlsHarness editor={editor} />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const rows = Array.from(container.querySelectorAll("tr"));
    const cells = Array.from(container.querySelectorAll("td"));

    if (!table || rows.length !== 2 || cells.length !== 4) {
      throw new Error("Expected a 2x2 table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 200, 100);
    stubRect(rows[0], 40, 40, 200, 50);
    stubRect(rows[1], 40, 90, 200, 50);
    stubRect(cells[0], 40, 40, 100, 50);
    stubRect(cells[1], 140, 40, 100, 50);
    stubRect(cells[2], 40, 90, 100, 50);
    stubRect(cells[3], 140, 90, 100, 50);

    fireEvent.pointerMove(cells[0], { clientX: 70, clientY: 65 });
    expect(await screen.findByRole("button", { name: "Add row" })).toBeTruthy();

    fireEvent.pointerMove(container, { clientX: 5, clientY: 5 });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    });
  });

  it("falls back to the last row and column when hovering table whitespace", async () => {
    const editor = {
      chain: () => chain,
      view: {
        posAtDOM: vi.fn(() => 7),
      },
    } as unknown as TiptapEditor;

    render(<TableControlsHarness editor={editor} />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const rows = Array.from(container.querySelectorAll("tr"));
    const cells = Array.from(container.querySelectorAll("td"));

    if (!table || rows.length !== 2 || cells.length !== 4) {
      throw new Error("Expected a 2x2 table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 200, 100);
    stubRect(rows[0], 40, 40, 200, 50);
    stubRect(rows[1], 40, 90, 200, 50);
    stubRect(cells[0], 40, 40, 100, 50);
    stubRect(cells[1], 140, 40, 100, 50);
    stubRect(cells[2], 40, 90, 100, 50);
    stubRect(cells[3], 140, 90, 100, 50);

    fireEvent.pointerMove(table, { clientX: 260, clientY: 160 });

    expect(await screen.findByRole("button", { name: "Add row" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add column" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete row" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete column" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));

    expect(chain.addRowAfter).toHaveBeenCalledTimes(1);
    expect(chain.addColumnAfter).toHaveBeenCalledTimes(1);
    expect(chain.setTextSelection).toHaveBeenCalledWith(8);
  });

  it("keeps controls stable over controls, halo, and safety zones", async () => {
    render(<TableControlsHarness editor={null} />);

    const container = screen.getByTestId("table-container");
    const table = container.querySelector("table");
    const rows = Array.from(container.querySelectorAll("tr"));
    const cells = Array.from(container.querySelectorAll("td"));

    if (!table || rows.length !== 2 || cells.length !== 4) {
      throw new Error("Expected a 2x2 table");
    }

    stubRect(container, 0, 0, 320, 320);
    stubRect(table, 40, 40, 200, 100);
    stubRect(rows[0], 40, 40, 200, 50);
    stubRect(rows[1], 40, 90, 200, 50);
    stubRect(cells[0], 40, 40, 100, 50);
    stubRect(cells[1], 140, 40, 100, 50);
    stubRect(cells[2], 40, 90, 100, 50);
    stubRect(cells[3], 140, 90, 100, 50);

    fireEvent.pointerMove(cells[0], { clientX: 70, clientY: 65 });
    const addRowButton = await screen.findByRole("button", { name: "Add row" });

    fireEvent.pointerMove(addRowButton, { clientX: 90, clientY: 90 });
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();

    fireEvent.pointerMove(container, { clientX: 50, clientY: 50 });
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();

    fireEvent.pointerMove(cells[1], { clientX: 90, clientY: 90 });
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();

    fireEvent.pointerLeave(container, { relatedTarget: addRowButton });
    expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();
  });
});
