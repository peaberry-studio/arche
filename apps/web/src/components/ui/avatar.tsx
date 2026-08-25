"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  DISC_ALPHAS,
  DISC_LEVELS,
  fieldFor,
  levelOf,
  resolutionForSize,
  sampleField,
  squareLattice,
  type AvatarKind,
  type DiscField,
} from "@/lib/avatar-disc";
import { cn } from "@/lib/utils";

/* ---------- suscripción al cambio de tema ---------- */

let themeVersion = 0;
const themeListeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribeToTheme(onChange: () => void) {
  themeListeners.add(onChange);

  if (!observer && typeof document !== "undefined") {
    observer = new MutationObserver(() => {
      themeVersion += 1;
      themeListeners.forEach((listener) => listener());
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
  }

  return () => {
    themeListeners.delete(onChange);
    if (themeListeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

function useThemeVersion() {
  return useSyncExternalStore(
    subscribeToTheme,
    () => themeVersion,
    () => 0,
  );
}

/* ---------- ticker compartido ---------- */

type Animated = { draw: (t: number) => void; start: number };

const animated = new Set<Animated>();
let frame = 0;

function startTicker() {
  if (frame) return;
  const step = (ts: number) => {
    animated.forEach((entry) => {
      if (!entry.start) entry.start = ts;
      entry.draw((ts - entry.start) / 1000);
    });
    frame = animated.size ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}

/* ---------- componente ---------- */

type GlyphAvatarProps = {
  /** Identificador estable: user.id o agent.id. Nunca el nombre. */
  seed: string;
  kind: AvatarKind;
  /** Lado del cuadro en píxeles CSS. Por defecto 24. */
  size?: number;
  /** true mientras la entidad está trabajando: el campo se pone en marcha. */
  active?: boolean;
  /**
   * Nombre para lectores de pantalla. Pásalo solo cuando el avatar aparezca
   * sin el nombre al lado; si el nombre ya está en el DOM contiguo, omítelo y
   * el avatar quedará marcado como decorativo.
   */
  label?: string;
  className?: string;
};

export function GlyphAvatar({
  seed,
  kind,
  size = 24,
  active = false,
  label,
  className,
}: GlyphAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const version = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const resolution = resolutionForSize(size);
    const points = squareLattice(resolution);
    const field: DiscField = fieldFor(seed);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.round(size * ratio);

    canvas.width = pixels;
    canvas.height = pixels;

    // Se resuelve una vez por montaje y por cambio de tema, nunca por frame.
    const color = window.getComputedStyle(canvas).color;
    const radius = pixels / 2;

    const draw = (t: number) => {
      context.clearRect(0, 0, pixels, pixels);
      context.fillStyle = color;

      for (const point of points) {
        const level = levelOf(sampleField(field, point.rad, point.th, t), DISC_LEVELS);
        const alpha = DISC_ALPHAS[level];
        if (alpha <= 0.001) continue;

        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(
          radius + point.x * radius * 0.94,
          radius + point.y * radius * 0.94,
          (point.size * radius * 0.94) / 2,
          0,
          Math.PI * 2,
        );
        context.fill();
      }

      context.globalAlpha = 1;
    };

    draw(0);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!active || reduced) return;

    const entry: Animated = { draw, start: 0 };
    animated.add(entry);
    startTicker();

    return () => {
      animated.delete(entry);
    };
    // `kind` entra en las dependencias porque decide la clase de color, y el
    // color se lee del DOM dentro de este efecto.
  }, [seed, size, active, kind, version]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "block shrink-0 select-none rounded-full",
        kind === "agent" ? "text-primary" : "text-foreground",
        className,
      )}
      style={{ height: size, width: size }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    />
  );
}
