"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shown instead of LocationFields when the event's chapter is "Virtual" —
 * shared by the admin event create wizard and edit form. A meeting link is
 * required (there's no physical address to fall back on); access notes
 * (passcode, dial-in, etc.) are optional.
 */
export function VirtualEventFields({
  idPrefix,
  virtualLink,
  virtualAccessNotes,
  onChangeLink,
  onChangeAccessNotes,
}: {
  idPrefix: string;
  virtualLink: string;
  virtualAccessNotes: string;
  onChangeLink: (value: string) => void;
  onChangeAccessNotes: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 rounded-md border p-3">
      <div className="text-sm font-medium">Virtual event details</div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_virtual_link`}>Zoom / meeting link</Label>
        <Input
          id={`${idPrefix}_virtual_link`}
          type="url"
          required
          placeholder="https://zoom.us/j/..."
          value={virtualLink}
          onChange={(e) => onChangeLink(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}_virtual_notes`}>Access notes</Label>
        <Textarea
          id={`${idPrefix}_virtual_notes`}
          placeholder="Passcode, dial-in number, etc. (optional)"
          value={virtualAccessNotes}
          onChange={(e) => onChangeAccessNotes(e.target.value)}
        />
      </div>
    </div>
  );
}
