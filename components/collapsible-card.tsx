"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card that opens and closes on its title, with a one-line summary while
 * closed. The same look as the profile page's collapsible sections. Used on
 * the admin contact profile.
 */
export function CollapsibleCard({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  /** Shown under the title while it's closed. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} className="scroll-mt-24">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 p-6 text-left"
      >
        <span className="flex flex-col gap-1">
          <span className="font-semibold leading-none tracking-tight">{title}</span>
          {!open && summary && <span className="text-sm text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
