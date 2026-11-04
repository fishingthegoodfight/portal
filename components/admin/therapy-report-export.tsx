"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The CSV downloads for grant reporting: counts only, unless "Include names"
 * is ticked, which adds a second file listing each person (and is logged).
 */
export function TherapyReportExport({ year, grain }: { year: number; grain: string }) {
  const [names, setNames] = useState(false);
  const base = `/protected/admin/therapy/reports/export?year=${year}&grain=${grain}`;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a href={base} download>
            Download counts (CSV)
          </a>
        </Button>
        {names && (
          <Button asChild size="sm" variant="outline">
            <a href={`${base}&names=1`} download>
              Download with names (CSV)
            </a>
          </Button>
        )}
      </div>
      <label className="flex items-start gap-2">
        <Checkbox className="mt-0.5" checked={names} onCheckedChange={(c) => setNames(c === true)} />
        <span>
          Include names
          <span className="block text-xs text-muted-foreground">
            A separate file with one row per person for {year}. Each download is recorded in the access log.
          </span>
        </span>
      </label>
    </div>
  );
}
