"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { addSessionsAction, deleteSessionAction } from "@/lib/actions/therapy-admin";
import { formatPlainDate, type SessionRow } from "@/lib/therapy-support";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One approval's sessions: the list (paid or not), and adding one date or a
 * batch from one therapist invoice. Never past the approval's sessions (the
 * database refuses it); the last one completes the request.
 */
export function TherapySessionsPanel({
  requestId,
  canAdd,
  sessions,
  sessionsApproved,
  today,
}: {
  requestId: number;
  /** The request is approved (sessions can only be added then). */
  canAdd: boolean;
  sessions: SessionRow[];
  sessionsApproved: number;
  /** YYYY-MM-DD in America/Denver, the latest a session can be. */
  today: string;
}) {
  const router = useRouter();
  const left = Math.max(sessionsApproved - sessions.length, 0);
  const [dates, setDates] = useState<string[]>([""]);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await addSessionsAction(requestId, dates, invoiceRef);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { added, completed, emailed } = result.data;
    setNotice(
      `${added} session${added === 1 ? "" : "s"} added.${
        completed ? ` That was the last one, so the request is complete.${emailed ? " They've been emailed." : ""}` : ""
      }`,
    );
    setDates([""]);
    setInvoiceRef("");
    router.refresh();
  };

  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await deleteSessionAction(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        {sessions.length} of {sessionsApproved} sessions used.
      </p>
      {sessions.length > 0 && (
        <ul className="flex flex-col divide-y">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {formatPlainDate(s.session_date)}
                {s.invoice_ref && <span className="text-muted-foreground"> · invoice {s.invoice_ref}</span>}
              </span>
              {s.paid_on ? (
                <span className="text-muted-foreground">Paid {formatPlainDate(s.paid_on)}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">Not paid</span>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(s.id)}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd && left > 0 && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <span className="font-medium">Add sessions</span>
          <div className="grid gap-2">
            <Label htmlFor="invoice_ref">Invoice number (optional)</Label>
            <Input id="invoice_ref" value={invoiceRef} maxLength={100} onChange={(e) => setInvoiceRef(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Session dates</span>
            {dates.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label={`Session date ${i + 1}`}
                  max={today}
                  value={d}
                  className="w-auto"
                  onChange={(e) => setDates((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                />
                {dates.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Remove this date"
                    onClick={() => setDates((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {dates.length < left && (
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => setDates((prev) => [...prev, ""])}>
                  Add another date
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {left} session{left === 1 ? "" : "s"} left on this approval. More needs a renewal.
            </p>
          </div>
          <div>
            <Button type="button" size="sm" disabled={busy || dates.every((d) => !d)} onClick={() => void add()}>
              {busy ? "Saving..." : `Add ${dates.filter(Boolean).length || ""} session${dates.filter(Boolean).length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
      {notice && <p className="text-green-700 dark:text-green-400">{notice}</p>}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
