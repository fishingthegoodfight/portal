"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";

/**
 * The chapter dropdown shared by the admin event create wizard and edit form
 * — same options in the same order, so the two can't drift apart. The chapter
 * also decides which state's liability waiver applies (see lib/waivers.ts).
 * "Virtual" is offered here alongside the real chapters — an EVENT can have
 * no physical chapter, unlike a person's own home chapter (see
 * components/chapter-select.tsx, which offers "No local chapter" instead).
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
        <option value={VIRTUAL_CHAPTER}>{VIRTUAL_CHAPTER}</option>
      </Select>
    </div>
  );
}
