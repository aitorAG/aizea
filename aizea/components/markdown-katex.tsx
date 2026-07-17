"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface MarkdownKatexProps {
  content: string;
  className?: string;
}

function MarkdownKatex({ content, className }: MarkdownKatexProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export { MarkdownKatex };
export type { MarkdownKatexProps };