"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestSupportRenewalAction, submitSupportRequestAction } from "@/lib/actions/therapy-support";
import {
  CONTACT_LABELS,
  INSURANCE_LABELS,
  PARTICIPANT_SHARE_DOLLARS,
  type ContactPreference,
  type InsuranceAnswer,
  type SupportRequestInput,
} from "@/lib/therapy-support";
import { US_STATE_NAMES } from "@/lib/us-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const EMPTY: SupportRequestInput = {
  program: "",
  therapistName: "",
  therapistPractice: "",
  therapistEmail: "",
  therapistPhone: "",
  therapistLicenseType: "",
  therapistLicenseState: "",
  hasInsurance: "",
  contactPreference: "",
  availability: "",
  note: "",
};

const NOTE_LABEL = "Anything you'd like us to know? (optional)";
const NOTE_HINT = "No need to share why you're looking for support. Only our small support team sees this.";

/** One choice in a radio group, styled as a bordered option. */
function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
        checked && "border-foreground bg-accent",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      {children}
    </label>
  );
}

/**
 * The Support request: "Do you currently have a therapist?" first. Yes →
 * the scholarship (their therapist's details and insurance); No → the
 * partner office (how to reach them and when). Only the chosen path's
 * answers are sent.
 */
export function SupportRequestForm() {
  const router = useRouter();
  const [input, setInput] = useState<SupportRequestInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SupportRequestInput>(key: K, value: SupportRequestInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await submitSupportRequestAction(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInput(EMPTY);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Do you currently have a therapist?</legend>
        <div className="flex flex-wrap gap-2">
          <Choice name="program" value="scholarship" checked={input.program === "scholarship"} onChange={() => set("program", "scholarship")}>
            Yes
          </Choice>
          <Choice name="program" value="partner" checked={input.program === "partner"} onChange={() => set("program", "partner")}>
            No
          </Choice>
        </div>
      </fieldset>

      {input.program === "scholarship" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Tell us about your therapist so we can arrange payment with them directly. You&apos;ll pay
            them at least ${PARTICIPANT_SHARE_DOLLARS} a session yourself, and we&apos;ll cover an agreed amount
            on top.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="therapist_name">Therapist&apos;s name</Label>
              <Input id="therapist_name" required value={input.therapistName} onChange={(e) => set("therapistName", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="therapist_practice">Practice</Label>
              <Input id="therapist_practice" value={input.therapistPractice} onChange={(e) => set("therapistPractice", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="therapist_email">Their email</Label>
              <Input id="therapist_email" type="email" value={input.therapistEmail} onChange={(e) => set("therapistEmail", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="therapist_phone">Their phone</Label>
              <Input id="therapist_phone" type="tel" value={input.therapistPhone} onChange={(e) => set("therapistPhone", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="therapist_license_type">License type</Label>
              <Input
                id="therapist_license_type"
                placeholder="e.g. LPC, LCSW, PsyD"
                value={input.therapistLicenseType}
                onChange={(e) => set("therapistLicenseType", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="therapist_license_state">License state</Label>
              <Select
                id="therapist_license_state"
                value={input.therapistLicenseState}
                onChange={(e) => set("therapistLicenseState", e.target.value)}
              >
                <option value="">Choose…</option>
                {Object.keys(US_STATE_NAMES).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Not sure of some of these? Fill in what you know. We can get the rest from your therapist.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              Do you have insurance that could cover part of the cost?
            </legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(INSURANCE_LABELS) as InsuranceAnswer[]).map((value) => (
                <Choice key={value} name="has_insurance" value={value} checked={input.hasInsurance === value} onChange={() => set("hasInsurance", value)}>
                  {INSURANCE_LABELS[value]}
                </Choice>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              If you have insurance, please use it where you can. It makes our help go further, so we
              can support more people.
            </p>
          </fieldset>
        </div>
      )}

      {input.program === "partner" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            We&apos;ll connect you with our partner office. Let us know the best way to reach you and
            when you&apos;re usually free.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">How would you like us to contact you?</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CONTACT_LABELS) as ContactPreference[]).map((value) => (
                <Choice
                  key={value}
                  name="contact_preference"
                  value={value}
                  checked={input.contactPreference === value}
                  onChange={() => set("contactPreference", value)}
                >
                  {CONTACT_LABELS[value]}
                </Choice>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="availability">When are you usually available?</Label>
            <Textarea
              id="availability"
              rows={2}
              maxLength={500}
              placeholder="e.g. weekday evenings, Saturday mornings"
              value={input.availability}
              onChange={(e) => set("availability", e.target.value)}
            />
          </div>
        </div>
      )}

      {input.program && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="note">{NOTE_LABEL}</Label>
            <Textarea id="note" rows={3} maxLength={2000} value={input.note} onChange={(e) => set("note", e.target.value)} />
            <p className="text-xs text-muted-foreground">{NOTE_HINT}</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Sending..." : "Send request"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

/** "Request more sessions" on an approval that has used all of its own. */
export function SupportRenewalButton({ previousId }: { previousId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await requestSupportRenewalAction(previousId, note);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Request more sessions
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm">
        We&apos;ll review it the same way as your first request, depending on what&apos;s available right
        now. Your details carry over.
      </p>
      <div className="grid gap-2">
        <Label htmlFor={`renewal_note_${previousId}`}>{NOTE_LABEL}</Label>
        <Textarea id={`renewal_note_${previousId}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-muted-foreground">{NOTE_HINT}</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? "Sending..." : "Send renewal request"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
