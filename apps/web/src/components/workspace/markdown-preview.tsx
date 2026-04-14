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

  return (
    <div>
      <MarkdownFrontmatterPanel frontmatter={frontmatter} />
      <div className="markdown-content pt-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
          {frontmatter.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
