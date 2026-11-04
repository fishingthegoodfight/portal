"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { registerForRetreatAction } from "@/lib/actions/retreat-registration";
import { signWaiverAction } from "@/lib/actions/waiver";
import { YourDetails } from "@/components/rsvp-form";
import { RegistrationSectionField } from "@/components/registration-section-field";
import { EMPTY_WAIVER_SIGN, WaiverSigning, waiverNeedsInput, type WaiverSignState } from "@/components/waiver-signing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { missingDetailsFields, type DetailsCardKey } from "@/lib/core-profile";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent";
import type { Chapter } from "@/lib/chapters";
import type { WaiverInfo } from "@/lib/waivers";
import {
  collectSectionUpdates,
  columnValuesFromProfile,
  firstIncompleteSection,
  incompleteSectionMessage,
  sectionsForEvent,
} from "@/lib/registration-sections";
import { formatPrice, type PriceOption } from "@/lib/retreats";
import { ROOM_REQUEST_INTRO } from "@/lib/retreat-registration";
import { cn } from "@/lib/utils";

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <span className="mr-2 text-muted-foreground">{n}.</span>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function errorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "Something went wrong";
}

/**
 * The retreat registration form: the person's details and the profile
 * sections the retreat asks for (emergency contact, experience and gear),
 * the waiver, the health form, then the price, an optional donation and a
 * room request. Profile answers and the waiver are saved first, the same
 * way as on the RSVP form; registerForRetreatAction then checks everything
 * again in the database.
 */
export function RetreatRegistrationForm({
  userId,
  eventId,
  retreatName,
  profile,
  profileFields,
  registrationSections,
  waiver,
  chapters,
  priceOptions,
  custom,
  health,
  full,
}: {
  userId: string;
  eventId: number;
  retreatName: string;
  profile: { first_name: string; last_name: string; phone: string; chapter: string };
  profileFields: Record<string, string>;
  registrationSections: string[];
  waiver: WaiverInfo;
  chapters: Chapter[];
  priceOptions: PriceOption[];
  /** A private price link's price, when they came from one. */
  custom: { token: string; amountCents: number } | null;
  health: { current: boolean; signedLabel: string | null; href: string };
  /** No spot free right now: they'll join the waitlist. */
  full: boolean;
}) {
  const router = useRouter();
  const sections = sectionsForEvent(registrationSections).filter((s) => s.kind !== "waiver");
  const asksWaiver = sectionsForEvent(registrationSections).some((s) => s.kind === "waiver");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(profileFields);
  const [missingDetails] = useState(() => missingDetailsFields(profile));
  const [details, setDetails] = useState<Record<DetailsCardKey, string>>(() => ({ ...profile }));
  const [smsConsent, setSmsConsent] = useState(false);
  const [waiverSign, setWaiverSign] = useState<WaiverSignState>(EMPTY_WAIVER_SIGN);
  const [priceId, setPriceId] = useState<number | null>(priceOptions.length === 1 ? priceOptions[0].id : null);
  const [donation, setDonation] = useState("");
  const [roomRequest, setRoomRequest] = useState(false);
  const [roomReason, setRoomReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsProblem = (() => {
    if (missingDetails.some((key) => !details[key].trim())) return "Add your name, phone and home chapter under Your details.";
    if (missingDetails.includes("phone") && details.phone.replace(/\D/g, "").length !== 10) {
      return "Enter a 10-digit phone number under Your details.";
    }
    return null;
  })();
  const incomplete = firstIncompleteSection(sections, fieldValues);
  const problems = [
    detailsProblem,
    incomplete ? incompleteSectionMessage(incomplete, fieldValues, ".") : null,
    asksWaiver && waiverNeedsInput(waiver, waiverSign) ? "Read and sign the waiver." : null,
    !health.current ? "Complete your health form." : null,
    !custom && priceId == null ? "Choose a price option." : null,
    roomRequest && !roomReason.trim() ? "Tell us why you need your own room." : null,
  ].filter((p): p is string => Boolean(p));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      if (missingDetails.length > 0) {
        const update: Record<string, unknown> = Object.fromEntries(missingDetails.map((key) => [key, details[key].trim()]));
        if (smsConsent) Object.assign(update, { sms_consent: true, sms_consent_text: SMS_CONSENT_TEXT });
        const { error: detailsError } = await supabase.from("profiles").update(update).eq("id", userId);
        if (detailsError) throw detailsError;
      }
      const profileUpdates = collectSectionUpdates(sections, profileFields, fieldValues);
      if (Object.keys(profileUpdates).length > 0) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update(columnValuesFromProfile(profileUpdates))
          .eq("id", userId);
        if (profileError) throw profileError;
      }
      if (asksWaiver && waiver.status === "unsigned") {
        const signed = await signWaiverAction(eventId, waiverSign.name, waiverSign.agreed);
        if (!signed.ok) throw new Error(signed.error);
      }
      const result = await registerForRetreatAction(eventId, {
        priceOptionId: custom ? null : priceId,
        customToken: custom?.token ?? "",
        donation,
        roomRequest,
        roomReason,
      });
      if (!result.ok) throw new Error(result.error);
      router.push(`/protected/retreats/${eventId}?registered=${result.status}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  let n = 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {full && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {retreatName} is full right now. Fill this in to join the waitlist: you won&apos;t be charged anything, and
          we&apos;ll email you if a spot opens up.
        </p>
      )}

      {!health.current && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-800 dark:text-amber-300">Start with your health form.</p>
          <p className="text-muted-foreground">
            It&apos;s needed to register, takes about ten minutes, and only trained staff see it. You&apos;ll come
            straight back here afterwards.
          </p>
          <div>
            <Button asChild size="sm">
              <Link href={health.href}>Complete your health form</Link>
            </Button>
          </div>
        </div>
      )}

      <Step n={++n} title="About you">
        {missingDetails.length > 0 && (
          <YourDetails
            missing={missingDetails}
            values={details}
            onChange={(key, value) => setDetails((prev) => ({ ...prev, [key]: value }))}
            chapters={chapters}
            smsConsent={smsConsent}
            onSmsConsentChange={setSmsConsent}
          />
        )}
        {sections.map((section) => (
          <RegistrationSectionField
            key={section.id}
            section={section}
            profileFields={profileFields}
            fieldValues={fieldValues}
            onChange={(key, value) => setFieldValues((prev) => ({ ...prev, [key]: value }))}
            editProfileHref={`/protected/profile?return_to=${encodeURIComponent(`/protected/retreats/${eventId}/register`)}`}
            editing={false}
            onStopEditing={() => {}}
          />
        ))}
      </Step>

      <Step n={++n} title="Health form and waiver">
        <div
          className={cn(
            "flex flex-col gap-2 rounded-md border p-3 text-sm",
            health.current ? "border-green-600/40 bg-green-600/5" : "border-amber-500/50 bg-amber-500/10",
          )}
        >
          {health.current ? (
            <p>
              <span className="font-medium">Health form: done.</span> Yours was signed {health.signedLabel}. About three
              weeks before the retreat we&apos;ll ask you to check it&apos;s still right.
            </p>
          ) : (
            <>
              <p>
                <span className="font-medium">Health form: needed.</span> Fill it in before registering (anything
                typed on this page would need filling in again).
              </p>
              <div>
                <Button asChild size="sm">
                  <Link href={health.href}>Complete your health form</Link>
                </Button>
              </div>
            </>
          )}
        </div>
        {asksWaiver && (
          <div className="grid gap-1 rounded-md border p-3">
            <span className="text-sm font-medium">Waiver</span>
            <WaiverSigning info={waiver} value={waiverSign} onChange={setWaiverSign} idPrefix="retreat" />
          </div>
        )}
      </Step>

      <Step
        n={++n}
        title="Price"
        description={custom ? undefined : "Choose what you'll pay. Every option gets the same retreat."}
      >
        {custom ? (
          <p className="rounded-md border p-3 text-sm">
            Your price for this retreat:{" "}
            <span className="font-medium">{custom.amountCents === 0 ? "no charge" : formatPrice(custom.amountCents)}</span>
          </p>
        ) : (
          <div role="radiogroup" aria-label="Price option" className="flex flex-col gap-2">
            {priceOptions.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm",
                  priceId === option.id && "border-green-700 bg-green-600/5",
                )}
              >
                <input
                  type="radio"
                  name="price_option"
                  className="mt-1"
                  checked={priceId === option.id}
                  onChange={() => setPriceId(option.id)}
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{option.label}</span>
                    <span className="tabular-nums">{option.amount_cents === 0 ? "Free" : formatPrice(option.amount_cents)}</span>
                  </span>
                  {option.description && <span className="text-muted-foreground">{option.description}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="retreat_donation">Additional donation (optional, $)</Label>
          <Input
            id="retreat_donation"
            inputMode="decimal"
            placeholder="0"
            value={donation}
            onChange={(e) => setDonation(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">On top of your price, to help someone else come.</p>
        </div>
      </Step>

      <Step n={++n} title="Room" description={ROOM_REQUEST_INTRO}>
        <label htmlFor="room_request" className="flex items-start gap-2 text-sm">
          <Checkbox
            id="room_request"
            className="mt-0.5"
            checked={roomRequest}
            onCheckedChange={(checked) => setRoomRequest(checked === true)}
          />
          <span>I&apos;m asking for my own room</span>
        </label>
        {roomRequest && (
          <div className="grid gap-1.5">
            <Label htmlFor="room_reason">Why do you need your own room?</Label>
            <Textarea id="room_reason" rows={3} value={roomReason} onChange={(e) => setRoomReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">Seen only by the retreat lead and admins.</p>
          </div>
        )}
      </Step>

      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        {!error && problems.length > 0 && <p className="text-sm text-muted-foreground">Still to do: {problems.join(" ")}</p>}
        <Button type="submit" className="w-fit" disabled={busy}>
          {busy ? "Registering..." : full ? "Join the waitlist" : "Register"}
        </Button>
      </div>
    </form>
  );
}
