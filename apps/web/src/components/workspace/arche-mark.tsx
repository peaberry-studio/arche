"use client";

/**
 * The Arche brand mark — the three stacked arcs of the isologo (the sphere
 * from the favicon), without any background. Used where the brand needs a
 * compact icon, e.g. the collapsed workspace sidebar.
 * Source: _brand_resources/peaberry/ark-isologo.svg
 */
import { ARC_PATHS } from "./arche-isologo";

type ArcheMarkProps = {
  className?: string;
  size?: number;
};

export function ArcheMark({ className, size = 20 }: ArcheMarkProps) {
  return (
    <svg
      viewBox="0 0 152 150"
      role="img"
      aria-label="Arche"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
    >
      {ARC_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
