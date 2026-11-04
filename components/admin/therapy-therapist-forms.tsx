"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  deletePaymentAction,
  recordPaymentAction,
  saveTherapistAction,
  setTherapistW9Action,
  type TherapistInput,
} from "@/lib/actions/therapy-admin";
import {
  formatCents,
  formatPlainDate,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type TherapistDetail,
} from "@/lib/therapy-support";
import { US_STATE_NAMES } from "@/lib/us-states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const FIELDS: [keyof TherapistInput, string][] = [
  ["name", "Name"],
  ["practice", "Practice"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["licenseType", "License type"],
];

/** A therapist's contact details and license: a new record (id null) or an
 * edit. Opens from a button so it stays out of the way. */
export function TherapistRecordForm({
  id,
  initial,
  buttonLabel,
}: {
  id: number | null;
  initial: TherapistInput;
  buttonLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TherapistInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await saveTherapistAction(id, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    if (id === null) {
      router.push(`/protected/admin/therapy/therapists/${result.data.id}`);
      return;
    }
    router.refresh();
  };

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(initial);
            setOpen(true);
          }}
        >
          {buttonLabel}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      {FIELDS.map(([key, label]) => (
        <div key={key} className="grid gap-1.5">
          <Label htmlFor={`therapist_${id ?? "new"}_${key}`}>{label}</Label>
          <Input
            id={`therapist_${id ?? "new"}_${key}`}
            required={key === "name"}
            value={draft[key]}
            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="grid gap-1.5">
        <Label htmlFor={`therapist_${id ?? "new"}_state`}>License state</Label>
        <Select
          id={`therapist_${id ?? "new"}_state`}
          value={draft.licenseState}
          onChange={(e) => setDraft((prev) => ({ ...prev, licenseState: e.target.value }))}
        >
          <option value="">—</option>
          {Object.keys(US_STATE_NAMES).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </div>
      {error && <p className="text-sm text-red-500 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "W-9 received", saved as soon as it's ticked. */
export function W9Checkbox({ therapistId, received }: { therapistId: number; received: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(received);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    setValue(next);
    const result = await setTherapistW9Action(therapistId, next);
    setBusy(false);
    if (!result.ok) {
      setValue(!next);
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value} disabled={busy} onCheckedChange={(c) => void toggle(c === true)} />
        W-9 received
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

/**
 * What's owed to one therapist: their unpaid sessions (all ticked to start),
 * and recording a payment for the ticked ones. The amount is each session's
 * agreed rate added up; the database works it out the same way.
 */
export function TherapistPaymentForm({
  therapistId,
  unpaid,
  today,
}: {
  therapistId: number;
  unpaid: TherapistDetail["unpaid"];
  today: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(unpaid.map((s) => s.id)));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const amount = unpaid.filter((s) => chosen.has(s.id)).reduce((sum, s) => sum + s.rate_cents, 0);
  const allChosen = chosen.size === unpaid.length;

  const record = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await recordPaymentAction({
      therapistId,
      sessionIds: [...chosen],
      paidOn,
      method,
      reference,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Payment of ${formatCents(amount)} recorded.`);
    setReference("");
    router.refresh();
  };

  if (unpaid.length === 0) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        {notice && <p className="text-green-700 dark:text-green-400">{notice}</p>}
        <p className="text-muted-foreground">Nothing owed: every logged session is paid.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 border-b pb-2 font-medium">
          <Checkbox
            checked={allChosen}
            onCheckedChange={(c) => setChosen(c === true ? new Set(unpaid.map((s) => s.id)) : new Set())}
          />
          {unpaid.length} unpaid session{unpaid.length === 1 ? "" : "s"}
        </label>
        <ul className="flex flex-col">
          {unpaid.map((s) => (
            <li key={s.id}>
              <label className="flex flex-wrap items-center gap-2 py-1">
                <Checkbox
                  checked={chosen.has(s.id)}
                  onCheckedChange={(c) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (c === true) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
                <span>{formatPlainDate(s.session_date)}</span>
                <span className="text-muted-foreground">
                  {s.person}
                  {s.invoice_ref && ` · invoice ${s.invoice_ref}`} · {formatCents(s.rate_cents)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-md border p-3">
        <span className="font-medium">
          Record a payment: {chosen.size} session{chosen.size === 1 ? "" : "s"}, {formatCents(amount)}
        </span>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="paid_on">Date paid</Label>
            <Input id="paid_on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="method">Method</Label>
            <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reference">{method === "check" ? "Check number" : "Reference"}</Label>
            <Input id="reference" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-red-500">{error}</p>}
        {notice && <p className="text-green-700 dark:text-green-400">{notice}</p>}
        <div>
          <Button type="button" size="sm" disabled={busy || chosen.size === 0 || !paidOn} onClick={() => void record()}>
            {busy ? "Saving..." : `Record ${formatCents(amount)} payment`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Voids a payment entered by mistake (its sessions become unpaid again).
 * Asks once first. */
export function VoidPaymentButton({ paymentId, label }: { paymentId: number; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await deletePaymentAction(paymentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  };

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Void
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Void the {label} payment? Its sessions become unpaid again.</span>
      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
        Void it
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
        Keep
      </Button>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </span>
  );
}
