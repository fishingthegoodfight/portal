"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  updateRetreatRegistrationAction,
  withdrawFromRetreatAction,
} from "@/lib/actions/retreat-registration";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { centsToInput, formatPrice, type PriceOption } from "@/lib/retreats";
import {
  ROOM_REQUEST_INTRO,
  ROOM_STATUS_LABELS,
  STATUS_LABELS,
  type RegistrationRow,
} from "@/lib/retreat-registration";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  confirmed: "border-l-green-600",
  pending_payment: "border-l-blue-600",
  offered: "border-l-blue-600",
  waitlisted: "border-l-amber-500",
  expired: "border-l-muted-foreground",
  cancelled: "border-l-muted-foreground",
};

const money = (cents: number) => (cents === 0 ? "$0" : formatPrice(cents));

/** The signed-in person's registration: where it stands, what they chose,
 * and what they can still change. */
export function MyRetreatRegistration({
  eventId,
  registration,
  waitlistPosition,
  offerExpiresLabel,
  priceOptions,
  canRegisterAgain,
}: {
  eventId: number;
  registration: RegistrationRow;
  waitlistPosition: number | null;
  /** When an open offer runs out, formatted in the retreat's zone. */
  offerExpiresLabel: string | null;
  priceOptions: PriceOption[];
  /** Registration is open, for someone whose earlier one ended. */
  canRegisterAgain: boolean;
}) {
  const router = useRouter();
  const r = registration;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = r.price_cents + r.donation_cents;
  const unpaid = r.status === "pending_payment" || r.status === "waitlisted" || r.status === "offered";

  const withdraw = async () => {
    const what = r.status === "offered" ? "decline this offer" : r.status === "waitlisted" ? "leave the waitlist" : "withdraw your registration";
    if (!confirm(`Are you sure you want to ${what}?`)) return;
    setBusy(true);
    setError(null);
    const result = await withdrawFromRetreatAction(eventId);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  };

  const claimFree = async () => {
    setBusy(true);
    setError(null);
    const result = await updateRetreatRegistrationAction(eventId, {
      priceOptionId: r.price_option_id,
      customToken: "",
      donation: centsToInput(r.donation_cents),
      roomRequest: r.room_request,
      roomReason: r.room_request_reason ?? "",
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else if (result.status !== "confirmed") setError("That spot couldn't be confirmed. Reply to the offer email and we'll help.");
    else router.refresh();
  };

  const statusLine = (() => {
    switch (r.status) {
      case "confirmed":
        return "You're confirmed. We're glad you're coming.";
      case "pending_payment":
        return "Your registration is in. Your spot is confirmed once your first payment goes through, and spots go to whoever pays first. Payment opens soon: we'll email you.";
      case "waitlisted":
        return `You're ${waitlistPosition ? `#${waitlistPosition} ` : ""}on the waitlist. You haven't been charged anything. If a spot opens up, we'll email you an offer with a deadline.`;
      case "offered":
        return `A spot is held for you${offerExpiresLabel ? ` until ${offerExpiresLabel}` : ""}. After that it goes to the next person on the waitlist.`;
      case "expired":
        return "The spot we offered you wasn't taken in time, so it went to the next person. Reply to the offer email if you'd still like to come.";
      case "cancelled":
        return `Your registration is cancelled${r.cancel_note ? ` (${r.cancel_note.toLowerCase()})` : ""}.`;
    }
  })();

  return (
    <Card className={cn("border-l-4", TONES[r.status])}>
      <CardHeader>
        <CardTitle>Your registration: {STATUS_LABELS[r.status]}</CardTitle>
        <CardDescription>{statusLine}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {r.status === "offered" && total === 0 && (
          <Button className="w-fit" disabled={busy} onClick={claimFree}>
            {busy ? "Claiming..." : "Claim your spot"}
          </Button>
        )}
        {r.status === "offered" && total > 0 && (
          <p className="rounded-md border bg-muted/50 p-3">
            Online payment opens soon. Reply to the offer email and we&apos;ll make sure your spot is held while it does.
          </p>
        )}

        {r.status !== "cancelled" && r.status !== "expired" && !editing && (
          <dl className="grid gap-2 sm:grid-cols-[9rem_1fr]">
            <dt className="text-muted-foreground">Price</dt>
            <dd>
              {r.price_label} · {money(r.price_cents)}
            </dd>
            {r.donation_cents > 0 && (
              <>
                <dt className="text-muted-foreground">Extra donation</dt>
                <dd>{money(r.donation_cents)}</dd>
              </>
            )}
            {r.donation_cents > 0 && (
              <>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-medium">{money(total)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Own room</dt>
            <dd>
              {r.room_request
                ? `Requested · ${ROOM_STATUS_LABELS[r.room_request_status ?? "pending"]}`
                : "Not requested"}
            </dd>
          </dl>
        )}

        {editing && (
          <ChangeForm
            eventId={eventId}
            registration={r}
            priceOptions={priceOptions}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        )}

        {!editing && (
          <div className="flex flex-wrap gap-2">
            {r.status !== "cancelled" && r.status !== "expired" && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {unpaid ? "Change my answers" : "Change my room request"}
              </Button>
            )}
            {unpaid && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={withdraw}>
                {r.status === "offered" ? "Decline the offer" : r.status === "waitlisted" ? "Leave the waitlist" : "Withdraw"}
              </Button>
            )}
            {(r.status === "cancelled" || r.status === "expired") && canRegisterAgain && (
              <Button asChild size="sm">
                <Link href={`/protected/retreats/${eventId}/register`}>Register again</Link>
              </Button>
            )}
          </div>
        )}
        {r.status === "confirmed" && (
          <p className="text-xs text-muted-foreground">
            Need to cancel? Reply to your confirmation email and we&apos;ll take care of it.
          </p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ChangeForm({
  eventId,
  registration: r,
  priceOptions,
  onDone,
  onCancel,
}: {
  eventId: number;
  registration: RegistrationRow;
  priceOptions: PriceOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const priceEditable = r.status !== "confirmed" && r.custom_price_id == null;
  const donationEditable = r.status !== "confirmed";
  const [priceId, setPriceId] = useState<number | null>(r.price_option_id);
  const [donation, setDonation] = useState(centsToInput(r.donation_cents));
  const [roomRequest, setRoomRequest] = useState(r.room_request);
  const [roomReason, setRoomReason] = useState(r.room_request_reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await updateRetreatRegistrationAction(eventId, {
      priceOptionId: priceId,
      customToken: "",
      donation,
      roomRequest,
      roomReason,
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else onDone();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-md border p-3">
      {priceEditable && (
        <div role="radiogroup" aria-label="Price option" className="flex flex-col gap-2">
          <span className="font-medium">Price</span>
          {priceOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2">
              <input type="radio" name="change_price" checked={priceId === option.id} onChange={() => setPriceId(option.id)} />
              {option.label} · {option.amount_cents === 0 ? "Free" : formatPrice(option.amount_cents)}
            </label>
          ))}
        </div>
      )}
      {donationEditable && (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="change_donation">Additional donation ($)</Label>
          <Input id="change_donation" inputMode="decimal" value={donation} onChange={(e) => setDonation(e.target.value)} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">{ROOM_REQUEST_INTRO}</p>
        <label htmlFor="change_room" className="flex items-start gap-2">
          <Checkbox id="change_room" className="mt-0.5" checked={roomRequest} onCheckedChange={(c) => setRoomRequest(c === true)} />
          I&apos;m asking for my own room
        </label>
        {roomRequest && (
          <div className="grid gap-1.5">
            <Label htmlFor="change_room_reason">Why do you need your own room?</Label>
            <Textarea id="change_room_reason" rows={3} value={roomReason} onChange={(e) => setRoomReason(e.target.value)} />
            {r.room_request_status && r.room_request_status !== "pending" && (
              <p className="text-xs text-muted-foreground">Changing this sends your request back for review.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving..." : "Save changes"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </form>
  );
}
