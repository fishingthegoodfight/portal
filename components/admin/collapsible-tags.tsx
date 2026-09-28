"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";

/** Past this many tags, a row shows COLLAPSED_COUNT and "+N more". */
const MAX_BEFORE_COLLAPSE = 4;
const COLLAPSED_COUNT = 3;

/**
 * A list row's tags (a volunteer's roles, say): wraps within its own block,
 * and past four collapses to the first three plus "+N more", which expands
 * in place. Four or fewer always show in full, so "+1 more" never hides a
 * single tag. `leading` and `trailing` (a status badge, a warning) always
 * show and don't count toward the limit.
 */
export function CollapsibleTags({
  tags,
  leading,
  trailing,
}: {
  tags: string[];
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = tags.length > MAX_BEFORE_COLLAPSE;
  const shown = collapsible && !expanded ? tags.slice(0, COLLAPSED_COUNT) : tags;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {leading}
      {shown.map((tag) => (
        <Badge key={tag} variant="secondary" className="max-w-full">
          <span className="truncate" title={tag}>
            {tag}
          </span>
        </Badge>
      ))}
      {collapsible && (
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `+${tags.length - COLLAPSED_COUNT} more`}
        </button>
      )}
      {trailing}
    </div>
  );
}
