"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { submitVolunteerApplicationAction } from "@/lib/actions/volunteer-applications";
import {
  APPLICATION_CHAPTER_OPTIONS,
  applicationErrors,
  AVAILABILITY_OPTIONS,
  BEGINNER_COMFORT_LABELS,
  EMPTY_APPLICATION,
  FISHING_FREQUENCY_OPTIONS,
  HELP_FREQUENCY_OPTIONS,
  HOW_LONG_ATTENDING_OPTIONS,
  INTEREST_AREA_KINDS,
  interestAreaLabel,
  RETREAT_COMMITMENTS,
  RETREAT_QUESTION,
  YEARS_FLY_FISHING_OPTIONS,
  type ApplicationInput,
  type InterestArea,
  type YesNo,
} from "@/lib/volunteer-applications";
import { formatPhoneNumber } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The volunteer application. Name, email and phone start from the profile
 * and can be changed here (saved with the application; the profile isn't
 * touched). Reference 1 is typed in — there's no list of volunteers to pick
 * from, which would expose the roster.
 */
export function VolunteerApplicationForm({
  contact,
  interestAreas,
}: {
  contact: Pick<ApplicationInput, "fullName" | "email" | "phone">;
  /** Active interest areas (both lists), in their Setup order. */
  interestAreas: Pick<InterestArea, "id" | "kind" | "label" | "description">[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ApplicationInput>({ ...EMPTY_APPLICATION, ...contact });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const onText =
    (key: keyof ApplicationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const onPhone = (key: keyof ApplicationInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: formatPhoneNumber(e.target.value) }));
  const setYesNo = (key: keyof ApplicationInput) => (value: YesNo) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const toggle = <T,>(list: T[], value: T, checked: boolean) =>
    checked ? [...list, value] : list.filter((v) => v !== value);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = applicationErrors(form);
    setErrors(problems);
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const result = await submitVolunteerApplicationAction(form);
      if (!result.ok) {
        setErrors([result.error]);
        return;
      }
      router.push("/protected/volunteer?applied=1");
      router.refresh();
    } catch (err) {
      console.error("Submit application failed:", err);
      setErrors(["Couldn't reach the server. Check your connection and try again — nothing was lost."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="app_name" label="Name" value={form.fullName} onChange={onText("fullName")} />
            <Field id="app_email" label="Email" type="email" value={form.email} onChange={onText("email")} />
            <Field id="app_phone" label="Phone" type="tel" value={form.phone} onChange={onPhone("phone")} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Which chapter would you volunteer with?</legend>
            <div className="flex flex-col gap-2 text-sm">
              {APPLICATION_CHAPTER_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="app_chapter"
                    checked={form.chapter === option.value}
                    onChange={() => setForm((prev) => ({ ...prev, chapter: option.value }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Area id="app_connected" label="How did you first get connected to FTGF?" value={form.howConnected} onChange={onText("howConnected")} />
          <Choice
            id="app_how_long"
            label="How long have you been coming to events?"
            options={HOW_LONG_ATTENDING_OPTIONS}
            value={form.howLongAttending}
            onChange={onText("howLongAttending")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Area id="app_why" label="Why do you want to volunteer?" value={form.whyVolunteer} onChange={onText("whyVolunteer")} />
          <Area id="app_hope" label="What do you hope to get out of it?" value={form.hopeToGet} onChange={onText("hopeToGet")} />
          <Area
            id="app_mission"
            label="Is there anything about our mission that connects to your own story? (optional)"
            value={form.missionConnection}
            onChange={onText("missionConnection")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you&apos;d like to help with</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {INTEREST_AREA_KINDS.map((kind) => (
            <fieldset key={kind.value} className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{kind.question}</legend>
              {interestAreas
                .filter((area) => area.kind === kind.value)
                .map((area) => (
                  <label key={area.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={form.interestAreaIds.includes(area.id)}
                      onCheckedChange={(c) =>
                        setForm((prev) => ({ ...prev, interestAreaIds: toggle(prev.interestAreaIds, area.id, c === true) }))
                      }
                    />
                    {interestAreaLabel(area)}
                  </label>
                ))}
              {kind.value === "skill" && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={form.interestOtherPicked}
                      onCheckedChange={(c) => setForm((prev) => ({ ...prev, interestOtherPicked: c === true }))}
                    />
                    Other
                  </label>
                  {form.interestOtherPicked && (
                    <Input
                      aria-label="Your other skill or interest area"
                      placeholder="Describe your other skill or interest area"
                      value={form.interestOther}
                      onChange={onText("interestOther")}
                    />
                  )}
                </>
              )}
            </fieldset>
          ))}
          <p className="text-xs text-muted-foreground">
            Pick as many as you like — we&apos;ll talk about specific roles later.
          </p>
          <div className="border-t pt-4">
            <YesNoField name="app_retreats" label={RETREAT_QUESTION} value={form.interestedInRetreats} onChange={setYesNo("interestedInRetreats")} />
            {form.interestedInRetreats === "true" && (
              <fieldset className="mt-4 grid gap-2 rounded-md border bg-muted/40 p-3">
                <legend className="px-1 text-sm font-medium">What retreat volunteering involves — tick each to confirm</legend>
                {RETREAT_COMMITMENTS.map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={form[c.key]}
                      onCheckedChange={(v) => setForm((prev) => ({ ...prev, [c.key]: v === true }))}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fly fishing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="app_years"
              label="How many years have you been fly fishing?"
              options={YEARS_FLY_FISHING_OPTIONS}
              value={form.yearsFlyFishing}
              onChange={onText("yearsFlyFishing")}
            />
            <Choice
              id="app_how_often"
              label="How often do you fish now?"
              options={FISHING_FREQUENCY_OPTIONS}
              value={form.fishingFrequency}
              onChange={onText("fishingFrequency")}
            />
          </div>
          <Field id="app_water" label="What water do you fish most?" value={form.waterFished} onChange={onText("waterFished")} />
          <YesNoField name="app_taught" label="Have you taught or guided anyone?" value={form.hasTaughtOrGuided} onChange={setYesNo("hasTaughtOrGuided")} />
          {form.hasTaughtOrGuided === "true" && (
            <Area id="app_taught_details" label="Tell us about it" value={form.taughtDetails} onChange={onText("taughtDetails")} />
          )}
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="app_comfort">How comfortable would you be teaching a complete beginner?</Label>
            <Select id="app_comfort" value={form.beginnerComfort} onChange={onText("beginnerComfort")}>
              <option value="">Choose 1–5</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {BEGINNER_COMFORT_LABELS[n]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Certifications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <YesNoField name="app_cpr" label="First Aid/CPR" value={form.certFirstAidCpr} onChange={setYesNo("certFirstAidCpr")} />
          {form.certFirstAidCpr === "true" && (
            <div className="sm:max-w-xs">
              <Field id="app_cpr_expires" label="Expires" type="date" value={form.certFirstAidCprExpires} onChange={onText("certFirstAidCprExpires")} />
            </div>
          )}
          <YesNoField name="app_wfa" label="Wilderness First Aid or WFR" value={form.certWfaWfr} onChange={setYesNo("certWfaWfr")} />
          <YesNoField name="app_ffi" label="FFI casting instructor" value={form.certFfiCasting} onChange={setYesNo("certFfiCasting")} />
          <YesNoField name="app_guide" label="Guide license" value={form.certGuideLicense} onChange={setYesNo("certGuideLicense")} />
          <Field id="app_cert_other" label="Other (optional)" value={form.certOther} onChange={onText("certOther")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">When could you help?</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {AVAILABILITY_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    checked={form.availability.includes(option.value)}
                    onCheckedChange={(c) =>
                      setForm((prev) => ({ ...prev, availability: toggle(prev.availability, option.value, c === true) }))
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Choice
            id="app_frequency"
            label="Roughly how often could you help?"
            options={HELP_FREQUENCY_OPTIONS}
            value={form.frequency}
            onChange={onText("frequency")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>References</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Reference 1 — a current FTGF volunteer</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="app_r1_name" label="Name" value={form.ref1Name} onChange={onText("ref1Name")} />
              <Field id="app_r1_email" label="Email" type="email" value={form.ref1Email} onChange={onText("ref1Email")} />
              <Field id="app_r1_phone" label="Phone" type="tel" value={form.ref1Phone} onChange={onPhone("ref1Phone")} />
            </div>
            <Field id="app_r1_how" label="How do they know you?" value={form.ref1HowKnow} onChange={onText("ref1HowKnow")} />
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Reference 2 — anyone who knows you well</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="app_r2_name" label="Name" value={form.ref2Name} onChange={onText("ref2Name")} />
              <Field id="app_r2_email" label="Email" type="email" value={form.ref2Email} onChange={onText("ref2Email")} />
              <Field id="app_r2_phone" label="Phone" type="tel" value={form.ref2Phone} onChange={onPhone("ref2Phone")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="app_r2_rel" label="Relationship" value={form.ref2Relationship} onChange={onText("ref2Relationship")} />
              <Field
                id="app_r2_known"
                label="How long have they known you?"
                value={form.ref2KnownFor}
                onChange={onText("ref2KnownFor")}
              />
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.referencesAcknowledged}
              onCheckedChange={(c) => setForm((prev) => ({ ...prev, referencesAcknowledged: c === true }))}
            />
            I understand FTGF will contact both of my references.
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anything else</CardTitle>
        </CardHeader>
        <CardContent>
          <Area id="app_else" label="Anything else we should know? (optional)" value={form.anythingElse} onChange={onText("anythingElse")} />
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <ul className="list-disc pl-4">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Submitting..." : "Submit application"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

function Choice({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div className="grid gap-1 sm:max-w-sm">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select id={id} value={value} onChange={onChange}>
        <option value="">Choose one</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Area({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={onChange} />
    </div>
  );
}

function YesNoField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: YesNo;
  onChange: (value: YesNo) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex gap-6 text-sm">
        {(["true", "false"] as const).map((choice) => (
          <label key={choice} className="flex items-center gap-2">
            <input type="radio" name={name} checked={value === choice} onChange={() => onChange(choice)} />
            {choice === "true" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
