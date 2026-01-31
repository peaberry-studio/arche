import { Fragment } from "react";

type MarkdownPreviewProps = {
  content: string;
};

const headingClasses = {
  h1: "text-xl font-semibold text-foreground",
  h2: "text-lg font-semibold text-foreground",
  h3: "text-base font-semibold text-foreground"
};

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const blocks = content.split("\n\n");

  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter(Boolean);
        const firstLine = lines[0] ?? "";

        if (firstLine.startsWith("# ")) {
          return (
            <h1 key={blockIndex} className={headingClasses.h1}>
              {renderInline(firstLine.slice(2))}
            </h1>
          );
        }

        if (firstLine.startsWith("## ")) {
          return (
            <h2 key={blockIndex} className={headingClasses.h2}>
              {renderInline(firstLine.slice(3))}
            </h2>
          );
        }

        if (firstLine.startsWith("### ")) {
          return (
            <h3 key={blockIndex} className={headingClasses.h3}>
              {renderInline(firstLine.slice(4))}
            </h3>
          );
        }

        if (lines.every((line) => line.trim().startsWith("- "))) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5 text-muted-foreground">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(/^\-\s*/, ""))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={blockIndex} className="text-muted-foreground">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}
