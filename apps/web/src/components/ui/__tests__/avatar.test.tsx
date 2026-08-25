/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { DISC_ALPHAS } from "@/lib/avatar-disc";

const INK = "rgb(24, 24, 27)";

type MountProps = {
  seed: string;
  kind: "agent" | "human";
  size?: number;
  active?: boolean;
  label?: string;
};

type CanvasLog = {
  clearRect: Mock;
  arc: Mock;
  fill: Mock;
  /** globalAlpha registrada en cada fill(). */
  alphas: number[];
  /** fillStyle vigente en cada fill(). */
  fillStyles: string[];
};

/**
 * jsdom no implementa getContext: se sustituye por un registro que apunta
 * las llamadas de dibujo del componente.
 */
function stubCanvasContext(): CanvasLog {
  const log: CanvasLog = {
    clearRect: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    alphas: [],
    fillStyles: [],
  };
  const context = {
    fillStyle: "",
    globalAlpha: 1,
    clearRect: log.clearRect,
    beginPath: vi.fn(),
    arc: log.arc,
    fill: () => {
      log.alphas.push(context.globalAlpha);
      log.fillStyles.push(context.fillStyle);
      log.fill();
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return log;
}

function installStubs(options: { reduced?: boolean } = {}) {
  // Sin invocar el callback: el ticker compartido quedaría en bucle síncrono.
  const raf = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: options.reduced ?? false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(window, "getComputedStyle").mockReturnValue({ color: INK } as CSSStyleDeclaration);
  const log = stubCanvasContext();
  return { log, raf };
}

function getCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector("canvas");
  expect(canvas).not.toBeNull();
  return canvas as HTMLCanvasElement;
}

async function mountAvatar(props: MountProps) {
  // Módulo fresco por test: el ticker y el observador de tema son estado
  // a nivel de módulo y no deben sangrar entre pruebas.
  const { GlyphAvatar } = await import("@/components/ui/avatar");
  return render(<GlyphAvatar {...props} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("GlyphAvatar", () => {
  it("es decorativo sin label y accesible con label", async () => {
    installStubs();

    const { container } = await mountAvatar({ seed: "agent-1", kind: "agent" });
    const canvas = getCanvas(container);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.getAttribute("role")).toBeNull();
    expect(canvas.getAttribute("aria-label")).toBeNull();

    const { container: labeled } = await mountAvatar({
      seed: "agent-1",
      kind: "agent",
      label: "Research analyst",
    });
    const named = getCanvas(labeled);
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Research analyst");
    expect(named.getAttribute("aria-hidden")).toBeNull();
  });

  it("fija el tamaño por CSS y distingue agente de humano por la tinta", async () => {
    installStubs();

    const { container: agent } = await mountAvatar({ seed: "agent-1", kind: "agent", size: 40 });
    const agentCanvas = getCanvas(agent);
    expect(agentCanvas.style.width).toBe("40px");
    expect(agentCanvas.style.height).toBe("40px");
    expect(agentCanvas.className).toContain("text-primary");
    expect(agentCanvas.className).toContain("rounded-full");

    const { container: human } = await mountAvatar({ seed: "user-1", kind: "human", size: 32 });
    const humanCanvas = getCanvas(human);
    expect(humanCanvas.style.width).toBe("32px");
    expect(humanCanvas.className).toContain("text-foreground");
    expect(humanCanvas.className).not.toContain("text-primary");
  });

  it("dibuja el fotograma de identidad al montar", async () => {
    const { log } = installStubs();

    const { container } = await mountAvatar({ seed: "agent-1", kind: "agent", size: 48 });
    const canvas = getCanvas(container);

    // Resolución canónica a 48px: 256 puntos de disco.
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(48);
    expect(log.clearRect).toHaveBeenCalledWith(0, 0, 48, 48);
    expect(log.arc).toHaveBeenCalledTimes(256);
    expect(log.fill).toHaveBeenCalledTimes(256);

    // La tinta se lee una vez del computed style y se usa en cada punto.
    expect(new Set(log.fillStyles)).toEqual(new Set([INK]));
    for (const alpha of log.alphas) {
      expect(DISC_ALPHAS).toContain(alpha);
    }
  });

  it("no anima en reposo", async () => {
    const { raf } = installStubs();

    await mountAvatar({ seed: "agent-1", kind: "agent", size: 48 });

    expect(raf).not.toHaveBeenCalled();
  });

  it("no anima con active si el usuario pide movimiento reducido", async () => {
    const { raf } = installStubs({ reduced: true });

    await mountAvatar({ seed: "agent-1", kind: "agent", size: 48, active: true });

    expect(raf).not.toHaveBeenCalled();
  });

  it("arranca el ticker compartido solo con active", async () => {
    const { raf } = installStubs();

    await mountAvatar({ seed: "agent-1", kind: "agent", size: 48, active: true });

    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("redibuja cuando cambia el tema", async () => {
    const { log } = installStubs();

    await mountAvatar({ seed: "agent-1", kind: "agent", size: 48 });
    expect(log.clearRect).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.documentElement.classList.add("dark");
    });

    // El MutationObserver invalida el color cacheado y el efecto vuelve a
    // dibujar el fotograma de identidad.
    await vi.waitFor(() => {
      expect(log.clearRect).toHaveBeenCalledTimes(2);
    });
  });
});
