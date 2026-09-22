"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deleteSeriesOccurrencesAction } from "@/lib/actions/admin-event-series";
import type { OccurrencePeople } from "@/lib/admin/series";
import { CancelEventDialog } from "@/components/admin/cancel-event-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SeriesOccurrence = {
  id: number;
  name: string;
  /** Pre-formatted in the event's own timezone. */
  dateRange: string;
  status: string;
  isPast: boolean;
  capacity: number | null;
  people: OccurrencePeople;
  /** Nobody on it — the only kind that can be deleted. */
  isEmpty: boolean;
};

/**
 * Every occurrence of a series with its registrations, plus the bulk actions:
 * cancel every upcoming occurrence (same flow as a single cancel, reason
 * emailed to each occurrence's attendees), and delete empty occurrences —
 * one at a time, or every future empty one at once to trim a series
 * generated too far out. Editing with "this and all future" scope happens on
 * each occurrence's edit form.
 */
export function SeriesOccurrences({
  seriesId,
  seriesName,
  frequencyLabel,
  occurrences,
}: {
  seriesId: string;
  seriesName: string;
  frequencyLabel: string | null;
  occurrences: SeriesOccurrence[];
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState<number | "future_empty" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const firstUpcoming = occurrences.find((o) => !o.isPast && o.status === "scheduled");
  const futureEmpty = occurrences.filter((o) => !o.isPast && o.isEmpty);

  const runDelete = async (which: number | "future_empty") => {
    setBusy(true);
    setMessage(null);
    const result = await deleteSeriesOccurrencesAction(seriesId, which === "future_empty" ? which : [which]);
    setBusy(false);
    setConfirmDelete(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    const parts = [`Deleted ${result.deletedCount} ${result.deletedCount === 1 ? "occurrence" : "occurrences"}.`];
    if (result.skippedCount > 0) {
      parts.push(
        `${result.skippedCount} ${result.skippedCount === 1 ? "wasn't" : "weren't"} deleted because someone registered in the meantime — cancel ${result.skippedCount === 1 ? "it" : "them"} instead.`,
      );
    }
    setMessage({ tone: result.skippedCount > 0 ? "error" : "ok", text: parts.join(" ") });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold">{seriesName}</h1>
        <p className="text-sm text-muted-foreground">
          Repeating series{frequencyLabel ? ` · ${frequencyLabel}` : ""} · {occurrences.length}{" "}
          {occurrences.length === 1 ? "occurrence" : "occurrences"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {firstUpcoming && (
          <CancelEventDialog
            eventId={firstUpcoming.id}
            eventName={`${seriesName} — all upcoming`}
            seriesId={seriesId}
            initialScope="future"
            label="Cancel all upcoming"
            onCancelled={() => router.refresh()}
          />
        )}
        {futureEmpty.length > 0 && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmDelete("future_empty")}
          >
            Delete all future empty occurrences ({futureEmpty.length})
          </Button>
        )}
      </div>

      {confirmDelete === "future_empty" && (
        <div
          role="alertdialog"
          className="flex flex-col gap-3 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm"
        >
          <p className="text-red-700 dark:text-red-400">
            Permanently delete <strong>{futureEmpty.length}</strong> upcoming{" "}
            {futureEmpty.length === 1 ? "occurrence" : "occurrences"} nobody has registered or
            volunteered for? {futureEmpty.map((o) => o.dateRange).join("; ")}. This can&apos;t be
            undone.
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => runDelete("future_empty")}>
              {busy ? "Deleting..." : `Delete ${futureEmpty.length}`}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmDelete(null)}>
              Keep them
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={cn("text-sm", message.tone === "ok" ? "text-green-600" : "text-red-500")}
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {occurrences.map((o) => (
          <Card key={o.id} className={cn(o.isPast && "opacity-70")}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.dateRange}</span>
                  {o.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                  {o.isPast && o.status !== "cancelled" && <Badge variant="outline">Past</Badge>}
                </div>
                <span className="text-sm text-muted-foreground">
                  {o.people.confirmed}
                  {o.capacity != null ? ` / ${o.capacity}` : ""} registered
                  {o.people.waiting > 0 && ` · ${o.people.waiting} waitlisted`}
                  {o.people.volunteers > 0 &&
                    ` · ${o.people.volunteers} ${o.people.volunteers === 1 ? "volunteer" : "volunteers"}`}
                  {o.name !== seriesName && ` · “${o.name}”`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/protected/admin/events/${o.id}`}>Manage</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/protected/admin/events/${o.id}/edit`}>Edit</Link>
                </Button>
                {o.isEmpty &&
                  (confirmDelete === o.id ? (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => runDelete(o.id)}
                      >
                        {busy ? "Deleting..." : "Confirm delete"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      title="Nobody is registered or volunteering, so this can be deleted"
                      onClick={() => setConfirmDelete(o.id)}
                    >
                      Delete
                    </Button>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
