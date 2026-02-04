import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DiffViewerProps = {
  diff: string;
  collapsed?: boolean;
  maxLinesCollapsed?: number;
  className?: string;
  onExpand?: () => void;
};

type DiffLine = {
  type: "meta" | "hunk" | "add" | "del" | "context";
  prefix: string;
  content: string;
  raw: string;
  oldLine?: number | null;
  newLine?: number | null;
  conflictRole?: "current" | "incoming" | "marker";
};

const HUNK_HEADER = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseUnifiedDiff(diff: string): DiffLine[] {
  if (!diff.trim()) return [];

  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let conflictMode: "current" | "incoming" | null = null;

  const applyConflictRole = (line: DiffLine): DiffLine => {
    if (line.type !== "add") return line;
    const trimmed = line.content;

    if (trimmed.startsWith("<<<<<<<")) {
      conflictMode = "current";
      return { ...line, conflictRole: "marker" };
    }
    if (trimmed.startsWith("=======")) {
      conflictMode = "incoming";
      return { ...line, conflictRole: "marker" };
    }
    if (trimmed.startsWith(">>>>>>>")) {
      conflictMode = null;
      return { ...line, conflictRole: "marker" };
    }

    if (conflictMode) {
      return { ...line, conflictRole: conflictMode };
    }

    return line;
  };

  for (const raw of lines) {
    if (raw === "") {
      continue;
    }

    if (raw.startsWith("diff --git") || raw.startsWith("index ")) {
      result.push({ type: "meta", prefix: "", content: raw, raw });
      inHunk = false;
      continue;
    }

    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      result.push({ type: "meta", prefix: "", content: raw, raw });
      continue;
    }

    if (raw.startsWith("@@")) {
      const match = HUNK_HEADER.exec(raw);
      if (match) {
        oldLine = Number.parseInt(match[1], 10);
        newLine = Number.parseInt(match[3], 10);
        inHunk = true;
      } else {
        inHunk = false;
      }
      result.push({ type: "hunk", prefix: "", content: raw, raw });
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      const line: DiffLine = {
        type: "add" as const,
        prefix: "+",
        content: raw.slice(1),
        raw,
        oldLine: null,
        newLine: inHunk ? newLine : null,
      };
      if (inHunk) newLine += 1;
      result.push(applyConflictRole(line));
      continue;
    }

    if (raw.startsWith("-") && !raw.startsWith("---")) {
      const line = {
        type: "del" as const,
        prefix: "-",
        content: raw.slice(1),
        raw,
        oldLine: inHunk ? oldLine : null,
        newLine: null,
      };
      if (inHunk) oldLine += 1;
      result.push(line);
      continue;
    }

    if (raw.startsWith(" ")) {
      const line = {
        type: "context" as const,
        prefix: " ",
        content: raw.slice(1),
        raw,
        oldLine: inHunk ? oldLine : null,
        newLine: inHunk ? newLine : null,
      };
      if (inHunk) {
        oldLine += 1;
        newLine += 1;
      }
      result.push(line);
      continue;
    }

    if (raw.startsWith("\\")) {
      result.push({ type: "meta", prefix: "", content: raw, raw });
      continue;
    }

    result.push({ type: "meta", prefix: "", content: raw, raw });
  }

  return result;
}

const lineTone = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  del: "bg-red-500/10 text-red-700 dark:text-red-400",
  context: "text-foreground/80",
  hunk: "bg-muted/50 text-muted-foreground font-medium",
  meta: "text-muted-foreground/70",
};

const lineNumberTone = {
  add: "text-emerald-600/80",
  del: "text-red-600/80",
  context: "text-muted-foreground/70",
  hunk: "text-muted-foreground/60",
  meta: "text-muted-foreground/60",
};

const conflictTone = {
  marker: "bg-amber-500/25 text-amber-800 dark:text-amber-300",
  current: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  incoming: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

const conflictNumberTone = {
  marker: "text-amber-700/80",
  current: "text-amber-700/70",
  incoming: "text-sky-700/70",
};

export function DiffViewer({
  diff,
  collapsed = false,
  maxLinesCollapsed = 120,
  className,
  onExpand,
}: DiffViewerProps) {
  const lines = parseUnifiedDiff(diff);

  if (lines.length === 0) {
    return (
      <div className={cn("px-3 py-3 text-xs text-muted-foreground", className)}>
        No diff available for this file.
      </div>
    );
  }

  const maxLines = collapsed ? Math.max(maxLinesCollapsed, 0) : lines.length;
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = Math.max(lines.length - visibleLines.length, 0);

  return (
    <div className={cn("text-[11px] font-mono leading-relaxed", className)}>
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {visibleLines.map((line, index) => {
            const content =
              line.type === "add" || line.type === "del" || line.type === "context"
                ? `${line.prefix}${line.content}`
                : line.raw;
            const tone = line.conflictRole ? conflictTone[line.conflictRole] : lineTone[line.type];
            const numberTone = line.conflictRole
              ? conflictNumberTone[line.conflictRole]
              : lineNumberTone[line.type];
            return (
              <div
                key={`${line.type}-${index}`}
                className={cn(
                  "grid grid-cols-[44px_44px_1fr] items-start gap-2 px-3 py-[2px]",
                  tone
                )}
              >
                <span
                  className={cn(
                    "select-none text-[10px] tabular-nums text-right",
                    numberTone
                  )}
                >
                  {line.oldLine ?? ""}
                </span>
                <span
                  className={cn(
                    "select-none text-[10px] tabular-nums text-right",
                    numberTone
                  )}
                >
                  {line.newLine ?? ""}
                </span>
                <span className="whitespace-pre">{content}</span>
              </div>
            );
          })}
        </div>
      </div>

      {collapsed && hiddenCount > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span>… {hiddenCount} hidden lines</span>
          {onExpand ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={onExpand}
            >
              View full diff
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
