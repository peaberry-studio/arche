/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusIndicator } from "@/components/workspace/bitmap-status-indicator";
import type { MessageStatusInfo } from "@/lib/opencode/types";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RECOVERY_DETAILS = [
  "stream_interrupted",
  "stream_status_unavailable",
  "upstream_eof",
  "upstream_stream_error",
];

describe("StatusIndicator", () => {
  it("shows Reconnecting... while thinking with a stream recovery detail", () => {
    for (const detail of RECOVERY_DETAILS) {
      const { unmount } = render(
        <StatusIndicator
          currentStatus={{ status: "thinking", detail } as MessageStatusInfo}
        />,
      );
      expect(screen.getByText("Reconnecting...")).toBeTruthy();
      unmount();
    }
  });

  it("shows Thinking... while thinking without a recovery detail", () => {
    const { rerender } = render(
      <StatusIndicator currentStatus={{ status: "thinking" } as MessageStatusInfo} />,
    );
    expect(screen.getByText("Thinking...")).toBeTruthy();

    rerender(
      <StatusIndicator
        currentStatus={{ status: "thinking", detail: "file.ts" } as MessageStatusInfo}
      />,
    );
    expect(screen.getByText("Thinking...")).toBeTruthy();
    expect(screen.queryByText("Reconnecting...")).toBeNull();
  });

  it("returns null when no status is provided", () => {
    const { container } = render(<StatusIndicator currentStatus={null} />);
    expect(container.firstChild).toBeNull();
  });
});
