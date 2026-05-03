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

function TableControlsHarness({ editor }: { editor: TiptapEditor }) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} data-testid="table-container" className="relative h-80 w-80 overflow-auto">
      <div className="workspace-tiptap">
        <table>
          <tbody>
            <tr>
              <td>Alpha</td>
              <td>Beta</td>
            </tr>
            <tr>
              <td>Gamma</td>
              <td>Delta</td>
            </tr>
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
});
