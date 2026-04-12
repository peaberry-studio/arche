"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CaretDown, CaretRight, Check, Info, PencilSimple, Plus, Trash } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createEmptyFrontmatterProperty,
  type MarkdownFrontmatterProperty,
  type ParsedMarkdownFrontmatter,
} from "@/components/workspace/markdown-frontmatter";

type MarkdownFrontmatterPanelProps = {
  frontmatter: ParsedMarkdownFrontmatter;
  editable?: boolean;
  onPropertiesChange?: (properties: MarkdownFrontmatterProperty[]) => void;
  onRawChange?: (raw: string) => void;
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

function formatPropertyValue(property: MarkdownFrontmatterProperty): string {
  if (property.type === "boolean") {
    return property.value ? "True" : "False";
  }
  if (property.type === "string[]") {
    return property.value.length > 0 ? property.value.join(", ") : "—";
  }
  const display = String(property.value);
  return display || "—";
}

function InfoPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-muted-foreground hover:bg-foreground/5"
        onClick={() => setOpen((previous) => !previous)}
        aria-label="What are properties?"
      >
        <Info size={13} weight="bold" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-border/50 bg-background/95 p-3 shadow-lg backdrop-blur-sm">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Properties are optional metadata fields stored as YAML frontmatter at
            the top of the file. They can hold text, numbers, booleans, or lists
            and are useful for categorising, filtering, or enriching your notes.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function MarkdownFrontmatterPanel({
  frontmatter,
  editable = false,
  onPropertiesChange,
  onRawChange,
}: MarkdownFrontmatterPanelProps) {
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [activeNumberDraft, setActiveNumberDraft] = useState<{
    index: number;
    value: string;
  } | null>(null);
  const [draftProperties, setDraftProperties] = useState<MarkdownFrontmatterProperty[]>(
    frontmatter.mode === "structured" ? frontmatter.properties : []
  );

  const updateDraftProperties = useCallback(
    (nextProperties: MarkdownFrontmatterProperty[], persist = true) => {
      setDraftProperties(nextProperties);

      if (!persist) {
        return;
      }

      onPropertiesChange?.(
        nextProperties.filter((property) => property.key.trim().length > 0)
      );
    },
    [onPropertiesChange]
  );

  if (!editable && frontmatter.mode === "none") {
    return null;
  }

  const showRaw = frontmatter.mode === "raw";
  const showStructured = frontmatter.mode === "structured" || (editable && frontmatter.mode === "none");
  const propertyCount =
    frontmatter.mode === "structured"
      ? frontmatter.properties.filter((property) => property.key.trim().length > 0).length
      : 0;

  return (
    <section className="px-4 pt-2 pb-1.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="group/props flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
            Properties
            {propertyCount > 0 ? (
              <span className="text-muted-foreground/50">({propertyCount})</span>
            ) : null}
          </button>
          <div className="opacity-0 transition-opacity group-hover/props:opacity-100">
            <InfoPopover />
          </div>
        </div>
        {editable && showStructured && !collapsed ? (
          <div className="flex items-center gap-1">
            {editing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setActiveNumberDraft(null);
                  updateDraftProperties([...draftProperties, createEmptyFrontmatterProperty()], false);
                }}
              >
                <Plus size={11} weight="bold" />
                Add
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
              onClick={() => {
                if (editing) {
                  setActiveNumberDraft(null);
                  setEditing(false);
                  return;
                }

                setActiveNumberDraft(null);
                setDraftProperties(frontmatter.mode === "structured" ? frontmatter.properties : []);
                setEditing(true);
              }}
            >
              {editing ? (
                <>
                  <Check size={11} weight="bold" />
                  Done
                </>
              ) : (
                <>
                  <PencilSimple size={11} weight="bold" />
                  Edit
                </>
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Raw mode */}
      {!collapsed && showRaw ? (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Raw YAML
          </p>
          <p className="text-[11px] text-muted-foreground/70">{formatRawReason(frontmatter.reason)}</p>
          {editable ? (
            <textarea
              aria-label="YAML frontmatter"
              className="min-h-28 w-full rounded-md border border-border/40 bg-foreground/[0.03] px-2.5 py-2 font-mono text-xs text-foreground transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
              spellCheck={false}
              value={frontmatter.raw}
              onChange={(event) => onRawChange?.(event.target.value)}
            />
          ) : (
            <pre className="overflow-x-auto rounded-md border border-border/40 bg-foreground/[0.03] px-2.5 py-2 font-mono text-xs text-foreground">
              {frontmatter.raw}
            </pre>
          )}
        </div>
      ) : null}

      {/* Structured: view mode */}
      {!collapsed && showStructured && !editing ? (
        <div className="mt-1.5">
          {propertyCount === 0 ? (
            <p className="py-0.5 text-[11px] text-muted-foreground/50">No properties yet.</p>
          ) : (
            <div className="space-y-0.5">
              {frontmatter.properties.map((property, index) => (
                <div key={index} className="flex items-baseline gap-3 py-0.5">
                  <span className="min-w-0 shrink-0 text-[11px] text-muted-foreground">
                    {property.key || "Untitled"}
                  </span>
                  {property.type === "string[]" ? (
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {property.value.length > 0 ? (
                        property.value.map((entry, entryIndex) => (
                          <Badge
                            key={entryIndex}
                            variant="secondary"
                            className="rounded px-1.5 py-0 text-[10px] font-normal"
                          >
                            {entry}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>
                  ) : (
                    <span className="min-w-0 truncate text-xs text-foreground">
                      {formatPropertyValue(property)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Structured: edit mode */}
      {!collapsed && showStructured && editing ? (
        <div className="mt-2 space-y-1.5">
          {draftProperties.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground/50">No properties yet.</p>
          ) : null}

          {draftProperties.map((property, index) => (
            <div
              key={index}
              className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_90px_minmax(0,1.6fr)_auto] md:items-center"
            >
              <Input
                aria-label={`Property ${index + 1} key`}
                placeholder="Name"
                className="h-7 rounded-md px-2 text-xs"
                value={property.key}
                onChange={(event) => {
                  const next = [...draftProperties];
                  next[index] = { ...property, key: event.target.value };
                  updateDraftProperties(next);
                }}
              />
              <select
                aria-label={`Property ${index + 1} type`}
                className="flex h-7 w-full appearance-none rounded-md border border-border bg-background bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M1%201l4%204%204-4%22%20stroke%3D%22%23888%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px_6px] bg-[right_8px_center] bg-no-repeat px-2 pr-6 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
                value={property.type}
                onChange={(event) => {
                  setActiveNumberDraft((current) => (current?.index === index ? null : current));
                  const next = [...draftProperties];
                  next[index] = coercePropertyValue(
                    property,
                    event.target.value as MarkdownFrontmatterProperty["type"]
                  );
                  updateDraftProperties(next);
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
                    className="h-7 rounded-md px-2 text-xs"
                    value={property.value}
                    onChange={(event) => {
                      const next = [...draftProperties];
                      next[index] = { ...property, value: event.target.value };
                      updateDraftProperties(next);
                    }}
                  />
                ) : null}

                {property.type === "number" ? (
                  <Input
                    aria-label={`Property ${index + 1} value`}
                    placeholder="0"
                    type="number"
                    className="h-7 rounded-md px-2 text-xs"
                    value={activeNumberDraft?.index === index ? activeNumberDraft.value : String(property.value)}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setActiveNumberDraft({ index, value: nextValue });

                      const parsed = Number.parseFloat(nextValue);
                      if (!Number.isFinite(parsed)) {
                        return;
                      }

                      const next = [...draftProperties];
                      next[index] = {
                        ...property,
                        value: parsed,
                      };
                      updateDraftProperties(next);
                    }}
                    onBlur={() => {
                      setActiveNumberDraft((current) => (current?.index === index ? null : current));
                    }}
                  />
                ) : null}

                {property.type === "boolean" ? (
                  <label className="flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-foreground">
                    <input
                      aria-label={`Property ${index + 1} value`}
                      checked={property.value}
                      type="checkbox"
                      onChange={(event) => {
                        const next = [...draftProperties];
                        next[index] = { ...property, value: event.target.checked };
                        updateDraftProperties(next);
                      }}
                    />
                    <span className="text-[11px]">{property.value ? "Enabled" : "Disabled"}</span>
                  </label>
                ) : null}

                {property.type === "string[]" ? (
                  <div className="space-y-1">
                    {property.value.map((entry, entryIndex) => (
                      <div key={entryIndex} className="flex items-center gap-1">
                        <Input
                          aria-label={`Property ${index + 1} list value ${entryIndex + 1}`}
                          placeholder="List item"
                          className="h-7 rounded-md px-2 text-xs"
                          value={entry}
                          onChange={(event) => {
                            const next = [...draftProperties];
                            const nextValues = [...property.value];
                            nextValues[entryIndex] = event.target.value;
                            next[index] = { ...property, value: nextValues };
                            updateDraftProperties(next);
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          aria-label={`Remove item ${entryIndex + 1}`}
                          onClick={() => {
                            setActiveNumberDraft((current) => (current?.index === index ? null : current));
                            const next = [...draftProperties];
                            next[index] = {
                              ...property,
                              value: property.value.filter((_, candidateIndex) => candidateIndex !== entryIndex),
                            };
                            updateDraftProperties(next);
                          }}
                        >
                          <Trash size={12} weight="bold" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => {
                        const next = [...draftProperties];
                        next[index] = { ...property, value: [...property.value, ""] };
                        updateDraftProperties(next);
                      }}
                    >
                      <Plus size={10} weight="bold" />
                      Add item
                    </Button>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                aria-label={`Remove property ${index + 1}`}
                onClick={() => {
                  setActiveNumberDraft((current) => (current?.index === index ? null : current));
                  updateDraftProperties(
                    draftProperties.filter((_, candidateIndex) => candidateIndex !== index)
                  );
                }}
              >
                <Trash size={12} weight="bold" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
