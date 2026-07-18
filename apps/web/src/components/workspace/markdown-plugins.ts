import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import remarkBracketMath from "@/components/workspace/remark-bracket-math";

export const workspaceRemarkPlugins = [remarkGfm, remarkMath, remarkBracketMath];
export const workspaceRehypePlugins = [rehypeKatex];
