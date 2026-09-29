"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { VIRTUAL_CHAPTER, type Chapter } from "@/lib/chapters";

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
  allowed,
  chapters,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** The chapters this person may put an event in (manageable_chapters —
   * everything for an admin, their own for a chapter lead). The current
   * value is always kept, so opening an event never silently changes it.
   * Omitted = every chapter. */
  allowed?: string[];
  /** Every chapter (loadChapters). Only active ones are offered, apart from
   * the current value. */
  chapters: Chapter[];
}) {
  const offered = (name: string) => !allowed || allowed.includes(name) || name === value;
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
        {chapters.filter((c) => (c.active && offered(c.name)) || c.name === value).map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}, {c.state}
          </option>
        ))}
        {offered(VIRTUAL_CHAPTER) && <option value={VIRTUAL_CHAPTER}>{VIRTUAL_CHAPTER}</option>}
      </Select>
    </div>
  );
}
