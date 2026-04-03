import type { InternalLinkSuggestion } from "@/lib/kb-internal-links";
import { cn } from "@/lib/utils";

type InternalLinkAutocompleteProps = {
  open: boolean;
  left: number;
  top: number;
  suggestions: InternalLinkSuggestion[];
  selectedIndex: number;
  onSelect: (path: string) => void;
};

export function InternalLinkAutocomplete({
  open,
  left,
  top,
  suggestions,
  selectedIndex,
  onSelect,
}: InternalLinkAutocompleteProps) {
  if (!open || suggestions.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left, top }}
      role="presentation"
    >
      <div className="pointer-events-auto min-w-[220px] max-w-[320px] rounded-md border border-white/10 bg-background/95 p-1 shadow-lg backdrop-blur-sm">
        {suggestions.map((entry, index) => (
          <button
            key={entry.path}
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs",
              index === selectedIndex
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(entry.path);
            }}
          >
            <span className="truncate font-medium">{entry.title}</span>
            <span className="ml-2 truncate text-[10px] text-muted-foreground">{entry.path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
