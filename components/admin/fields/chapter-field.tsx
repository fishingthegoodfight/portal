"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CHAPTERS } from "@/lib/chapters";

/**
 * The chapter dropdown shared by the admin event create wizard and edit form
 * — same options in the same order, so the two can't drift apart. The chapter
 * also decides which state's liability waiver applies (see lib/waivers.ts).
 */
export function ChapterField({
  idPrefix,
  value,
  onChange,
  required = true,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={`${idPrefix}_chapter`}>Chapter</Label>
      <Select
        id={`${idPrefix}_chapter`}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a chapter</option>
        {CHAPTERS.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}, {c.state}
          </option>
        ))}
      </Select>
    </div>
  );
}
