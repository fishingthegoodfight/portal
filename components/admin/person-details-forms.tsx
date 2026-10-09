"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  saveContactDetailsAction,
  saveProfileSectionAction,
  type ContactDetailsInput,
  type PeopleActionResult,
} from "@/lib/actions/people";
import type { Chapter } from "@/lib/chapters";
import { formatPhoneNumber, formatPostalCode } from "@/lib/phone";
import { REGISTRATION_SECTIONS, visibleFields } from "@/lib/registration-sections";
import { US_STATES } from "@/lib/us-states";
import { HomeChapterField } from "@/components/chapter-select";
import { EmergencyContactSectionFields } from "@/components/emergency-contact-fields";
import { RegistrationFieldInput } from "@/components/registration-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Save button, error and "Saved." for each form on the contact profile. */
function useSave(save: () => Promise<PeopleActionResult>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await save();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved(true);
    router.refresh();
  };
  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Saving..." : "Save"}
      </Button>
      {saved && <span className="text-sm text-green-600">Saved.</span>}
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
  return { submit, footer, changed: () => setSaved(false) };
}

/** Name, phone, home chapter and address. The email is shown, not edited:
 * it's their login. */
export function ContactDetailsForm({
  userId,
  email,
  initial,
  chapters,
}: {
  userId: string;
  email: string;
  initial: ContactDetailsInput;
  chapters: Chapter[];
}) {
  const [values, setValues] = useState(initial);
  const { submit, footer, changed } = useSave(() => saveContactDetailsAction(userId, values));
  const set = (key: keyof ContactDetailsInput, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    changed();
  };
  const text = (key: keyof ContactDetailsInput) => ({
    id: `person_${key}`,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value),
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="person_first_name">First name</Label>
          <Input required {...text("first_name")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="person_last_name">Last name</Label>
          <Input required {...text("last_name")} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="person_email">Email</Label>
        <Input id="person_email" type="email" value={email} readOnly aria-describedby="person_email_note" />
        <p id="person_email_note" className="text-xs text-muted-foreground">
          The email they log in with, so it can&apos;t be changed here.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="person_phone">Phone</Label>
        <Input
          {...text("phone")}
          type="tel"
          inputMode="numeric"
          placeholder="(303) 555-0100"
          maxLength={14}
          onChange={(e) => set("phone", formatPhoneNumber(e.target.value))}
        />
      </div>
      <HomeChapterField
        idPrefix="person"
        value={values.chapter}
        onChange={(v) => set("chapter", v)}
        chapters={chapters}
        required={false}
      />
      <div className="grid gap-2">
        <Label htmlFor="person_address_line1">Address line 1</Label>
        <Input {...text("address_line1")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="person_address_line2">Address line 2</Label>
        <Input placeholder="Apt, suite, etc. (optional)" {...text("address_line2")} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="person_city">City</Label>
          <Input {...text("city")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="person_state">State</Label>
          <Select id="person_state" value={values.state} onChange={(e) => set("state", e.target.value)}>
            <option value="">State</option>
            {US_STATES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="person_postal_code">ZIP code</Label>
          <Input
            {...text("postal_code")}
            inputMode="numeric"
            placeholder="12345"
            maxLength={10}
            onChange={(e) => set("postal_code", formatPostalCode(e.target.value))}
          />
        </div>
      </div>
      {footer}
    </form>
  );
}

/** One registration section (emergency contacts, dietary, sizing, …), laid
 * out from the catalog the way the profile page does it. */
export function ProfileSectionForm({
  userId,
  sectionId,
  initial,
}: {
  userId: string;
  sectionId: string;
  /** Every registration field's value, keyed by its profile column. */
  initial: Record<string, string>;
}) {
  const section = REGISTRATION_SECTIONS.find((s) => s.id === sectionId);
  const [values, setValues] = useState(initial);
  const { submit, footer, changed } = useSave(() => saveProfileSectionAction(userId, sectionId, values));
  if (!section) return null;
  const onChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    changed();
  };
  const fields = visibleFields(section, values);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {section.id === "emergency_contact" ? (
        <EmergencyContactSectionFields values={values} onChange={onChange} />
      ) : (
        <div className={fields.length > 1 && section.layout !== "stack" ? "grid grid-cols-2 gap-4" : "grid gap-3"}>
          {fields.map((field) => (
            <RegistrationFieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={onChange} />
          ))}
        </div>
      )}
      {footer}
    </form>
  );
}
