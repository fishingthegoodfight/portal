"use client";

import { useState } from "react";

import { saveVolunteerNotesAction } from "@/lib/actions/volunteer-admin";
import { VOLUNTEER_NOTES_HELP } from "@/lib/volunteers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** General notes (volunteer_notes): admins edit, chapter leads for the
 * volunteer's chapter can read them on event rosters. Not the screening
 * notes (VolunteerAdminNotes). */
export function VolunteerNotes({ volunteerId, initialNotes }: { volunteerId: string; initialNotes: string }) {
  const [notes, setNotes] = useState(initialNotes);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    const result = await saveVolunteerNotesAction(volunteerId, notes);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Notes"
        aria-describedby="volunteer_notes_help"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={4}
      />
      <p id="volunteer_notes_help" className="text-xs text-muted-foreground">
        {VOLUNTEER_NOTES_HELP} Visible to admins and to chapter leads for this volunteer&apos;s home chapter.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && <p className="text-sm text-green-600">Saved.</p>}
      <div>
        <Button type="button" size="sm" disabled={isSaving} onClick={handleSave}>
          {isSaving ? "Saving..." : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
