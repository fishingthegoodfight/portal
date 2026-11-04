"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  cancelRetreatRegistrationAction,
  createCustomPriceAction,
  offerRetreatSpotAction,
  returnToWaitlistAction,
  revokeCustomPriceAction,
  saveRetreatSettingsAction,
  setRoomRequestStatusAction,
} from "@/lib/actions/retreat-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RegistrationStatus, RoomStatus } from "@/lib/retreat-registration";

type Result = { ok: true } | { ok: false; error: string };
const plain = (r: { ok: true } | { ok: false; error: string }): Result => (r.ok ? { ok: true } : r);

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (action: () => Promise<Result & { notice?: string }>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error);
    else {
      if (result.notice) setNotice(result.notice);
      router.refresh();
    }
  };
  return { busy, error, notice, run };
}

/** Offer / return to the waitlist / cancel, for one registration. */
export function RegistrationActions({
  registrationId,
  status,
  name,
}: {
  registrationId: number;
  status: RegistrationStatus;
  name: string;
}) {
  const { busy, error, notice, run } = useRun();
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");

  const offer = () =>
    run(async () => {
      if (!confirm(`Offer ${name} a spot? They'll get an email with a link and a deadline.`)) return { ok: true };
      const r = await offerRetreatSpotAction(registrationId);
      if (!r.ok) return r;
      return { ok: true, notice: r.data.emailed ? "Offer sent." : "Offered, but the email didn't go out: let them know." };
    });

  if (cancelling) {
    return (
      <div className="flex flex-col gap-1.5">
        <Input
          aria-label="Reason (they'll see it)"
          placeholder="Reason (they'll see it)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 text-sm"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !note.trim()}
            onClick={() =>
              run(async () => {
                const r = await cancelRetreatRegistrationAction(registrationId, note.trim());
                if (r.ok) setCancelling(false);
                return r.ok ? { ok: true } : r;
              })
            }
          >
            {busy ? "Cancelling..." : "Cancel registration"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
            Keep
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  const active = status !== "cancelled" && status !== "expired";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {(status === "waitlisted" || status === "expired") && (
          <Button size="sm" disabled={busy} onClick={offer}>
            Offer spot
          </Button>
        )}
        {(status === "offered" || status === "expired") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(async () => plain(await returnToWaitlistAction(registrationId)))}
          >
            Back to waitlist
          </Button>
        )}
        {active && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(true)}>
            Cancel
          </Button>
        )}
      </div>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

/** Approve / decline (emails the person) or reset a room request. */
export function RoomDecision({ registrationId, status }: { registrationId: number; status: RoomStatus }) {
  const { busy, error, run } = useRun();
  const set = (next: RoomStatus) =>
    run(async () => plain(await setRoomRequestStatusAction(registrationId, next)));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {status !== "approved" && (
          <Button size="sm" disabled={busy} onClick={() => set("approved")}>
            Approve
          </Button>
        )}
        {status !== "declined" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => set("declined")}>
            Decline
          </Button>
        )}
        {status !== "pending" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("pending")}>
            Back to pending
          </Button>
        )}
      </div>
      {status === "pending" && <p className="text-xs text-muted-foreground">Approving or declining emails them.</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export type CustomPriceLink = {
  id: number;
  url: string;
  amountLabel: string;
  note: string;
  createdLabel: string;
  usedBy: string | null;
  revoked: boolean;
};

/** Private price links: one per person, $0 included. */
export function CustomPriceLinks({ eventId, links }: { eventId: number; links: CustomPriceLink[] }) {
  const { busy, error, run } = useRun();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setCopied(null);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await createCustomPriceAction(eventId, amount, note);
      if (!r.ok) return r;
      const url = `${window.location.origin}/protected/retreats/${eventId}/register?price=${r.data.token}`;
      setCreated(url);
      setAmount("");
      setNote("");
      return { ok: true };
    });
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="custom_amount">Amount ($)</Label>
          <Input
            id="custom_amount"
            inputMode="decimal"
            placeholder="0"
            className="w-28"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="custom_note">Who it&apos;s for (only managers see this)</Label>
          <Input id="custom_note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create link"}
        </Button>
      </form>
      {error && <p className="text-red-500">{error}</p>}
      {created && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/50 p-3">
          <p>Send this link to the person. It works once, for whoever signs in with it.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all text-xs">{created}</code>
            <Button size="sm" variant="outline" type="button" onClick={() => copy(created)}>
              {copied === created ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      {links.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex flex-col">
                <span className="font-medium">
                  {l.amountLabel} · {l.note}
                </span>
                <span className="text-xs text-muted-foreground">
                  Created {l.createdLabel} ·{" "}
                  {l.revoked ? "Revoked" : l.usedBy ? `Used by ${l.usedBy}` : "Not used yet"}
                </span>
              </div>
              {!l.revoked && !l.usedBy && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" type="button" onClick={() => copy(l.url)}>
                    {copied === l.url ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (!confirm("Revoke this link? It stops working straight away.")) return { ok: true };
                        const r = await revokeCustomPriceAction(l.id);
                        return r.ok ? { ok: true } : r;
                      })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How long a waitlist offer is held (all retreats). Admins only. */
export function RetreatSettingsForm({ offerHours }: { offerHours: number }) {
  const { busy, error, notice, run } = useRun();
  const [hours, setHours] = useState(String(offerHours));
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await saveRetreatSettingsAction(hours);
          return r.ok ? { ok: true, notice: "Saved." } : r;
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="offer_hours">Hours to accept a waitlist offer</Label>
        <Input id="offer_hours" inputMode="numeric" className="w-28" value={hours} onChange={(e) => setHours(e.target.value)} />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
      {notice && <span className="text-muted-foreground">{notice}</span>}
      {error && <span className="text-red-500">{error}</span>}
    </form>
  );
}
