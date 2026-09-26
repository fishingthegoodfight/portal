import Link from "next/link";

import {
  concernOf,
  levelLabel,
  levelOf,
  notesOf,
  outcomeLabel,
  READS,
  readOf,
  sectionsFor,
  type ScreeningRecord,
} from "@/lib/volunteer-screenings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCheckDate } from "@/lib/practical-checks";

/**
 * One screening call, read-only, for someone who passed
 * can_record_screening (the review page only renders these for them). Each
 * section shows its level with that level's descriptor, and any Concern.
 * No total.
 */
export function ScreeningView({
  record,
  recordedByName,
  updatedByName,
  editHref,
  formatWhen,
  roleNames,
}: {
  record: ScreeningRecord;
  recordedByName: string;
  updatedByName: string;
  /** Set when this viewer may edit it (its recorder, or an admin). */
  editHref: string | null;
  formatWhen: (iso: string) => string;
  /** Names for recommended_role_type_ids. */
  roleNames: string[];
}) {
  const edited = record.updated_at !== record.recorded_at;
  const concerns = sectionsFor(record.retreat_track).filter((s) => concernOf(record, s.key));
  return (
    <article className="flex flex-col gap-4 rounded-md border p-4 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            Call on {record.call_date} with {record.interviewer_name}
            {record.retreat_track ? " · retreat track" : " · chapter track"}
          </p>
          <p className="text-xs text-muted-foreground">
            Recorded by {recordedByName}, {formatWhen(record.recorded_at)}
            {edited ? ` · last edited by ${updatedByName}, ${formatWhen(record.updated_at)}` : ""}
          </p>
        </div>
        {editHref && (
          <Button asChild size="sm" variant="outline">
            <Link href={editHref}>Edit</Link>
          </Button>
        )}
      </header>

      <div
        className={cn(
          "rounded-md border p-3",
          record.outcome === "decline" ? "border-red-500/50 bg-red-500/5" : "bg-muted/40",
        )}
      >
        <p className="font-medium">
          Next step: {outcomeLabel(record.outcome, record.decline_is_recommendation)}
          {record.outcome === "hold" && record.revisit_on ? ` — revisit from ${formatCheckDate(record.revisit_on)}` : ""}
        </p>
        <p className="mt-1 whitespace-pre-line">{record.summary}</p>
      </div>

      {concerns.length > 0 && (
        <p className="rounded-md border border-amber-500/60 bg-amber-500/10 p-2 font-medium text-amber-800 dark:text-amber-300">
          Concern flagged: {concerns.map((s) => s.title).join("; ")}
        </p>
      )}

      <div className="grid gap-1.5 sm:grid-cols-2">
        {READS.map((r) => (
          <p key={r.key}>
            <span className="font-medium">{r.label}:</span> {readOf(record, r.key)}
          </p>
        ))}
      </div>
      <p>
        <span className="font-medium">Recommended roles:</span> {roleNames.length > 0 ? roleNames.join(", ") : "None"}
      </p>

      {sectionsFor(record.retreat_track).map((section) => {
        const level = levelOf(record, section.key);
        const notes = notesOf(record, section.key);
        return (
          <section key={section.key} className={cn("flex flex-col gap-1", section.emphasis && "rounded-md border-2 border-red-600 p-2")}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{section.title}</h3>
              <Badge variant={level === "needs_improvement" ? "destructive" : "outline"}>{levelLabel(level)}</Badge>
              {concernOf(record, section.key) && (
                <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">Concern</Badge>
              )}
            </div>
            {level && <p className="text-xs text-muted-foreground">{section.descriptors[level]}</p>}
            {notes && <p className="whitespace-pre-line">{notes}</p>}
          </section>
        );
      })}
    </article>
  );
}
