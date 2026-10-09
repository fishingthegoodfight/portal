"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { logMemberTouchAction } from "@/lib/actions/members";
import { TOUCH_TYPE_LABELS, TOUCH_TYPES, type TouchType } from "@/lib/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * "Log outreach": how they were reached, when, and a short note. Saved as a
 * member_touches row, which takes them off "Needs outreach". On Members and
 * the admin contact profile.
 */
export function LogOutreachForm({
  memberId,
  today,
  onDone,
}: {
  memberId: string;
  today: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<TouchType>("call");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await logMemberTouchAction({ memberId, type, touchedOn: on, note });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone();
    router.refresh();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
      <div role="group" aria-label="How" className="flex flex-wrap gap-2">
        {TOUCH_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              type === t ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
            )}
          >
            {TOUCH_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className="w-auto" aria-label="Date" />
        <Input
          placeholder="Short note (optional)"
          maxLength={280}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-48 flex-1"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-red-500">{error}</p>}
    </form>
  );
}
