import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { workspaceMarkdownComponents } from "@/components/workspace/markdown-components";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={workspaceMarkdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
