"use client";

import { useState } from "react";

import { saveVolunteerAdminNotesAction } from "@/lib/actions/volunteer-admin";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Only ever rendered for an admin whose own profile has
 * can_view_volunteer_screening true — the page loader checks that before
 * including this component at all, and the write is enforced again in RLS
 * (volunteer_screening_notes_admin policy), independent of this UI check. */
export function VolunteerAdminNotes({
  volunteerId,
  initialNotes,
}: {
  volunteerId: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    const result = await saveVolunteerAdminNotesAction(volunteerId, notes);
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
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="Screening notes — visible only to admins with screening access."
      />
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
