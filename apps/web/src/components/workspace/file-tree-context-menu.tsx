"use client";

import { DownloadSimple, File, FileDoc, FilePdf } from "@phosphor-icons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FileTreeContextMenuProps = {
  fileName: string;
  onDownload: () => void;
  onExportDocx?: () => void;
  onExportPdf?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  x: number;
  y: number;
};

export function FileTreeContextMenu({
  fileName,
  onDownload,
  onExportDocx,
  onExportPdf,
  onOpenChange,
  open,
  x,
  y,
}: FileTreeContextMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={{ left: x, top: y }}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" sideOffset={6}>
        <DropdownMenuLabel className="flex min-w-0 items-center gap-2">
          <File size={14} weight="bold" className="shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{fileName}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onDownload}>
          <DownloadSimple size={14} />
          Download file
        </DropdownMenuItem>
        {onExportPdf ? (
          <DropdownMenuItem onSelect={onExportPdf}>
            <FilePdf size={14} />
            Export as PDF
          </DropdownMenuItem>
        ) : null}
        {onExportDocx ? (
          <DropdownMenuItem onSelect={onExportDocx}>
            <FileDoc size={14} />
            Export as DOCX
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
