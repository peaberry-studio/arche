import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownFrontmatterPanel } from "@/components/workspace/markdown-frontmatter-panel";
import { parseMarkdownFrontmatter } from "@/components/workspace/markdown-frontmatter";
import { workspaceMarkdownComponents } from "@/components/workspace/markdown-components";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const frontmatter = parseMarkdownFrontmatter(content);
  const showProperties = frontmatter.mode !== "none";

  return (
    <div>
      <MarkdownFrontmatterPanel frontmatter={frontmatter} />
      {showProperties ? (
        <div className="mx-4 pt-2 pb-4">
          <div className="h-px bg-border/40" />
        </div>
      ) : null}
      <div className="markdown-content px-6 pt-1 pb-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
          {frontmatter.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
