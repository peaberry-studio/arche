"use client";

type PanelResizeHandleProps = {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  position: "left" | "right";
  hidden?: boolean;
};

export function PanelResizeHandle({
  onPointerDown,
  position,
  hidden
}: PanelResizeHandleProps) {
  if (hidden) return null;

  return (
    <div
      className="group relative w-px shrink-0 cursor-col-resize self-stretch bg-border transition-colors hover:bg-primary/50"
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={
        position === "left"
          ? "Resize left panel"
          : "Resize right panel"
      }
    >
      {/* Larger invisible hit area to make dragging easier */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
