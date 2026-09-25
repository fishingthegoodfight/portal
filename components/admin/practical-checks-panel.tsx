"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { recordPracticalCheckAction } from "@/lib/actions/practical-checks";
import {
  formatCheckDate,
  PRACTICAL_OUTCOMES,
  practicalCheckSummary,
  practicalOutcomeLabel,
  type PracticalCheck,
  type PracticalOutcome,
} from "@/lib/practical-checks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * A person's practical instruction checks: the one that counts (the
 * latest) up top with its date and assessor, the history below, and — for
 * someone who can record one — the form. No expiry; the date is there for
 * the reader to judge.
 */
export function PracticalChecksPanel({
  userId,
  checks,
  recorderNames,
  canRecord,
  defaultAssessor,
}: {
  userId: string;
  /** Newest first. */
  checks: PracticalCheck[];
  recorderNames: Record<string, string>;
  canRecord: boolean;
  defaultAssessor: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkedOn, setCheckedOn] = useState(new Date().toISOString().slice(0, 10));
  const [assessor, setAssessor] = useState(defaultAssessor);
  const [outcome, setOutcome] = useState<PracticalOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = checks[0] ?? null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await recordPracticalCheckAction(userId, { checkedOn, assessorName: assessor, outcome, notes });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setOutcome("");
    setNotes("");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p
        className={cn(
          "rounded-md border p-3 font-medium",
          latest?.outcome === "passed"
            ? "border-green-600/50 bg-green-600/5"
            : "border-amber-500/60 bg-amber-500/10",
        )}
      >
        {practicalCheckSummary(latest)}
        {latest?.outcome !== "passed" && (
          <span className="block text-xs font-normal text-muted-foreground">
            Needed before an instructor shift at a retreat or other event that requires health history.
          </span>
        )}
      </p>

      {checks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {checks.map((c, i) => (
            <li key={c.id} className={cn("rounded-md border p-2", i > 0 && "opacity-80")}>
              <p>
                <span className="font-medium">{practicalOutcomeLabel(c.outcome)}</span> · {formatCheckDate(c.checked_on)} ·
                assessed by {c.assessor_name}
                {i === 0 && checks.length > 1 && <span className="text-xs text-muted-foreground"> (the one that counts)</span>}
              </p>
              {c.notes && <p className="whitespace-pre-line text-muted-foreground">{c.notes}</p>}
              <p className="text-xs text-muted-foreground">
                Recorded by {(c.recorded_by && recorderNames[c.recorded_by]) || "a reviewer"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canRecord &&
        (open ? (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="pc_date" className="text-xs">Date</Label>
                <Input id="pc_date" type="date" value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="pc_assessor" className="text-xs">Who assessed them</Label>
                <Input id="pc_assessor" value={assessor} onChange={(e) => setAssessor(e.target.value)} />
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-xs font-medium">Outcome</legend>
              {PRACTICAL_OUTCOMES.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5">
                  <input type="radio" name="pc_outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                  {o.label}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-1">
              <Label htmlFor="pc_notes" className="text-xs">Notes</Label>
              <Textarea id="pc_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={saving} onClick={save}>
                {saving ? "Saving..." : "Save check"}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              Record a practical check
            </Button>
          </div>
        ))}
    </div>
  );
}
