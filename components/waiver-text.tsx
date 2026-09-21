import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";

/**
 * A waiver's markdown rendered as readable text. react-markdown doesn't
 * render raw HTML, so waiver text (admin-entered) can't inject markup.
 */
export function WaiverText({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold [&_a]:underline",
        className,
      )}
    >
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
