"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateVolunteerStatusAction } from "@/lib/actions/volunteer-admin";
import { VOLUNTEER_STATUSES, VOLUNTEER_STATUS_LABELS } from "@/lib/volunteers";
import { Select } from "@/components/ui/select";

export function VolunteerStatusSelect({ volunteerId, status }: { volunteerId: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const onChange = async (next: string) => {
    setValue(next);
    setError(null);
    setIsSaving(true);
    const result = await updateVolunteerStatusAction(volunteerId, next);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      setValue(status);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <Select value={value} disabled={isSaving} onChange={(e) => onChange(e.target.value)}>
        {VOLUNTEER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {VOLUNTEER_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
