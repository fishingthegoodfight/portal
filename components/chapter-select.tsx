"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { NOT_LOCAL_CHAPTER, type Chapter } from "@/lib/chapters";

/**
 * The chapter dropdown shared by every place a person picks their OWN home
 * chapter — the profile page, volunteer registration, and the admin walk-up
 * form. Distinct from components/admin/fields/chapter-field.tsx, which picks
 * an EVENT's chapter and also offers "Virtual" (never appropriate here: a
 * person's home chapter is never "Virtual", only "no local chapter").
 */
export function HomeChapterField({
  idPrefix,
  value,
  onChange,
  required = true,
  chapters,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** Every chapter (loadChapters). Active ones are offered, plus the current
   * value if its chapter has since been deactivated. */
  chapters: Chapter[];
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}_chapter`}>Chapter</Label>
      <Select
        id={`${idPrefix}_chapter`}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a chapter</option>
        {chapters.filter((c) => c.active || c.name === value).map((chapter) => (
          <option key={chapter.name} value={chapter.name}>
            {chapter.name}, {chapter.state}
          </option>
        ))}
        <option value={NOT_LOCAL_CHAPTER}>{NOT_LOCAL_CHAPTER}</option>
      </Select>
    </div>
  );
}
