"use client";

import { useState } from "react";
import Link from "next/link";

import { saveEventAsTemplateAction } from "@/lib/actions/event-templates";
import { CHAPTERS, VIRTUAL_CHAPTER } from "@/lib/chapters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** A good event can become a template without re-entering it — copies
 * title, description, capacity, registration sections, location, virtual
 * details, and catalog-backed volunteer roles (shift times become offsets
 * from the event's start). */
export function SaveAsTemplateButton({
  eventId,
  eventName,
  eventChapter,
}: {
  eventId: number;
  eventName: string;
  eventChapter: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(`${eventName} template`);
  const [chapter, setChapter] = useState(eventChapter ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ templateId: number; skippedRoles: number } | null>(null);

  const open = () => {
    setIsOpen(true);
    setError(null);
    setResult(null);
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    const res = await saveEventAsTemplateAction(eventId, { name, chapter });
    setIsSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ templateId: res.templateId, skippedRoles: res.skippedRoles });
  };

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={open}>
        Save as template
      </Button>
    );
  }

  // Full width when it opens inside a row of buttons (the event page).
  return (
    <Card className="w-full basis-full">
      <CardHeader>
        <CardTitle>Save as template</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>Template saved.</p>
            {result.skippedRoles > 0 && (
              <p className="text-amber-600">
                {result.skippedRoles} volunteer{" "}
                {result.skippedRoles === 1 ? "role wasn't" : "roles weren't"} included — a
                &quot;Custom / other&quot; role has no catalog role type to save into a template.
              </p>
            )}
            <Link
              href="/protected/admin/event-templates"
              className="w-fit underline underline-offset-4"
            >
              View templates
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="save_template_name">Template name</Label>
              <Input
                id="save_template_name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="save_template_chapter">Available to</Label>
              <Select
                id="save_template_chapter"
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
              >
                <option value="">All chapters</option>
                {CHAPTERS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}, {c.state}
                  </option>
                ))}
                <option value={VIRTUAL_CHAPTER}>{VIRTUAL_CHAPTER}</option>
              </Select>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        {result ? (
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" disabled={isSaving || !name.trim()} onClick={save}>
              {isSaving ? "Saving..." : "Save template"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
