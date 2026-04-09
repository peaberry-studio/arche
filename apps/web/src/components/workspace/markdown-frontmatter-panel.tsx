import { Plus, Trash } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  MarkdownFrontmatterProperty,
  ParsedMarkdownFrontmatter,
} from "@/components/workspace/markdown-frontmatter";
import { cn } from "@/lib/utils";

type MarkdownFrontmatterPanelProps = {
  frontmatter: ParsedMarkdownFrontmatter;
  editable?: boolean;
  onPropertiesChange?: (properties: MarkdownFrontmatterProperty[]) => void;
  onRawChange?: (raw: string) => void;
  onAddProperty?: () => void;
};

function coercePropertyValue(
  property: MarkdownFrontmatterProperty,
  nextType: MarkdownFrontmatterProperty["type"]
): MarkdownFrontmatterProperty {
  if (nextType === property.type) {
    return property;
  }

  if (nextType === "string") {
    return {
      key: property.key,
      type: "string",
      value: Array.isArray(property.value) ? property.value.join(", ") : String(property.value),
    };
  }

  if (nextType === "number") {
    const source = Array.isArray(property.value) ? property.value.join(" ") : String(property.value);
    const parsed = Number.parseFloat(source);

    return {
      key: property.key,
      type: "number",
      value: Number.isFinite(parsed) ? parsed : 0,
    };
  }

  if (nextType === "boolean") {
    const source = Array.isArray(property.value) ? property.value.join(" ") : String(property.value);
    return {
      key: property.key,
      type: "boolean",
      value: /^(true|yes|1)$/iu.test(source),
    };
  }

  return {
    key: property.key,
    type: "string[]",
    value: Array.isArray(property.value)
      ? property.value
      : property.value === ""
        ? []
        : [String(property.value)],
  };
}

function formatRawReason(reason: ParsedMarkdownFrontmatter["reason"]): string {
  if (reason === "invalid") {
    return "This YAML block is invalid, so it stays in raw mode until it parses cleanly.";
  }

  return "This YAML uses structures the properties UI does not support yet, so it stays in raw mode.";
}

function ReadonlyPropertyValue({ property }: { property: MarkdownFrontmatterProperty }) {
  if (property.type === "boolean") {
    return <span className="text-sm text-foreground">{property.value ? "True" : "False"}</span>;
  }

  if (property.type === "string[]") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {property.value.map((entry, index) => (
          <Badge key={`${property.key}-${index}`} variant="secondary" className="rounded-md px-2 py-1 text-[11px]">
            {entry}
          </Badge>
        ))}
        {property.value.length === 0 ? <span className="text-sm text-muted-foreground">Empty list</span> : null}
      </div>
    );
  }

  return <span className="break-all text-sm text-foreground">{String(property.value)}</span>;
}

export function MarkdownFrontmatterPanel({
  frontmatter,
  editable = false,
  onPropertiesChange,
  onRawChange,
  onAddProperty,
}: MarkdownFrontmatterPanelProps) {
  if (!editable && frontmatter.mode === "none") {
    return null;
  }

  const showRaw = frontmatter.mode === "raw";
  const showStructured = frontmatter.mode === "structured" || (editable && frontmatter.mode === "none");

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Properties
          </p>
          <Badge variant={showRaw ? "warning" : "outline"}>{showRaw ? "Raw YAML" : "YAML"}</Badge>
        </div>
        {editable && showStructured && onAddProperty ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onAddProperty}>
            <Plus size={12} weight="bold" />
            Add property
          </Button>
        ) : null}
      </div>

      {showRaw ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{formatRawReason(frontmatter.reason)}</p>
          {editable ? (
            <textarea
              aria-label="YAML frontmatter"
              className="min-h-36 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              spellCheck={false}
              value={frontmatter.raw}
              onChange={(event) => onRawChange?.(event.target.value)}
            />
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/60 px-3 py-3 font-mono text-xs text-foreground">
              {frontmatter.raw}
            </pre>
          )}
        </div>
      ) : null}

      {showStructured ? (
        <div className="mt-3 space-y-3">
          {frontmatter.properties.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/30 px-3 py-4 text-sm text-muted-foreground">
              {editable ? "No YAML properties yet." : "No YAML properties."}
            </div>
          ) : null}

          {frontmatter.properties.map((property, index) => (
            <div
              key={`${property.key}-${index}`}
              className={cn(
                "rounded-lg border border-border/80 bg-background/40 p-3",
                editable && "space-y-3"
              )}
            >
              {editable ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_120px_minmax(0,1.8fr)_auto] md:items-start">
                  <Input
                    aria-label={`Property ${index + 1} key`}
                    placeholder="Property name"
                    value={property.key}
                    onChange={(event) => {
                      const next = [...frontmatter.properties];
                      next[index] = { ...property, key: event.target.value };
                      onPropertiesChange?.(next);
                    }}
                  />
                  <select
                    aria-label={`Property ${index + 1} type`}
                    className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    value={property.type}
                    onChange={(event) => {
                      const next = [...frontmatter.properties];
                      next[index] = coercePropertyValue(
                        property,
                        event.target.value as MarkdownFrontmatterProperty["type"]
                      );
                      onPropertiesChange?.(next);
                    }}
                  >
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Toggle</option>
                    <option value="string[]">List</option>
                  </select>
                  <div className="min-w-0">
                    {property.type === "string" ? (
                      <Input
                        aria-label={`Property ${index + 1} value`}
                        placeholder="Value"
                        value={property.value}
                        onChange={(event) => {
                          const next = [...frontmatter.properties];
                          next[index] = { ...property, value: event.target.value };
                          onPropertiesChange?.(next);
                        }}
                      />
                    ) : null}

                    {property.type === "number" ? (
                      <Input
                        aria-label={`Property ${index + 1} value`}
                        placeholder="0"
                        type="number"
                        value={String(property.value)}
                        onChange={(event) => {
                          const parsed = Number.parseFloat(event.target.value);
                          const next = [...frontmatter.properties];
                          next[index] = {
                            ...property,
                            value: Number.isFinite(parsed) ? parsed : 0,
                          };
                          onPropertiesChange?.(next);
                        }}
                      />
                    ) : null}

                    {property.type === "boolean" ? (
                      <label className="flex h-10 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                        <input
                          aria-label={`Property ${index + 1} value`}
                          checked={property.value}
                          type="checkbox"
                          onChange={(event) => {
                            const next = [...frontmatter.properties];
                            next[index] = { ...property, value: event.target.checked };
                            onPropertiesChange?.(next);
                          }}
                        />
                        <span>{property.value ? "Enabled" : "Disabled"}</span>
                      </label>
                    ) : null}

                    {property.type === "string[]" ? (
                      <div className="space-y-2">
                        {property.value.map((entry, entryIndex) => (
                          <div key={`${property.key}-${entryIndex}`} className="flex items-center gap-2">
                            <Input
                              aria-label={`Property ${index + 1} list value ${entryIndex + 1}`}
                              placeholder="List item"
                              value={entry}
                              onChange={(event) => {
                                const next = [...frontmatter.properties];
                                const nextValues = [...property.value];
                                nextValues[entryIndex] = event.target.value;
                                next[index] = { ...property, value: nextValues };
                                onPropertiesChange?.(next);
                              }}
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-10 w-10 shrink-0"
                              aria-label={`Remove item ${entryIndex + 1}`}
                              onClick={() => {
                                const next = [...frontmatter.properties];
                                next[index] = {
                                  ...property,
                                  value: property.value.filter((_, candidateIndex) => candidateIndex !== entryIndex),
                                };
                                onPropertiesChange?.(next);
                              }}
                            >
                              <Trash size={14} weight="bold" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            const next = [...frontmatter.properties];
                            next[index] = { ...property, value: [...property.value, ""] };
                            onPropertiesChange?.(next);
                          }}
                        >
                          <Plus size={12} weight="bold" />
                          Add item
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 shrink-0"
                    aria-label={`Remove property ${index + 1}`}
                    onClick={() => {
                      onPropertiesChange?.(
                        frontmatter.properties.filter((_, candidateIndex) => candidateIndex !== index)
                      );
                    }}
                  >
                    <Trash size={14} weight="bold" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {property.key || "Untitled property"}
                  </p>
                  <ReadonlyPropertyValue property={property} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
