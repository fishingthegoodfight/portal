"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { submitHealthHistoryAction } from "@/lib/actions/health-history";
import {
  ABILITY_OPTIONS,
  CONSENT_EMERGENCY_TREATMENT,
  CONSENT_SHARE_WITH_EMS,
  conditionsNeedingExplanation,
  EMPTY_HEALTH_HISTORY,
  followUpsFor,
  HEALTH_CONDITION_GROUPS,
  HEALTH_FORM_INTRO,
  healthHistoryErrors,
  MOBILITY_INTRO,
  MOBILITY_QUESTIONS,
  SWIMMING_OPTIONS,
  type HealthHistoryInput,
  type YesNo,
} from "@/lib/health-history";
import { formatPhoneNumber } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ContactPrefill = Pick<
  HealthHistoryInput,
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "emergencyContactRelationship"
  | "emergencyContact2Name"
  | "emergencyContact2Phone"
  | "emergencyContact2Relationship"
>;

/**
 * This year's health form. Starts blank every year — last year's answers
 * are viewable but never copied in, so each year's is consciously
 * re-entered. The one exception is the emergency contacts, which are the
 * profile's own (live, roster-visible) contacts, shown here to confirm or
 * update.
 */
export function HealthHistoryForm({
  year,
  contacts,
  returnTo,
}: {
  year: number;
  contacts: ContactPrefill;
  /** Where to go once it's submitted. */
  returnTo: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<HealthHistoryInput>({ ...EMPTY_HEALTH_HISTORY, ...contacts });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof HealthHistoryInput>(key: K) => (value: HealthHistoryInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const onText =
    (key: keyof HealthHistoryInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const onPhone = (key: keyof HealthHistoryInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: formatPhoneNumber(e.target.value) }));

  const toggleCondition = (key: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      noConditions: checked ? false : prev.noConditions,
      conditions: checked ? [...prev.conditions, key] : prev.conditions.filter((c) => c !== key),
    }));

  const followUps = form.noConditions ? new Set() : followUpsFor(form.conditions);
  const needsExplanation =
    !form.noConditions &&
    (conditionsNeedingExplanation(form.conditions).length > 0 || form.conditionsOther.trim() !== "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = healthHistoryErrors(form, new Date().toISOString().slice(0, 10));
    setErrors(problems);
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const result = await submitHealthHistoryAction(form);
      if (!result.ok) {
        setErrors([result.error]);
        return;
      }
      window.location.href = returnTo;
    } catch (err) {
      console.error("Submit health form failed:", err);
      setErrors(["Couldn't reach the server. Check your connection and try again — nothing was lost."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <p className="rounded-md border bg-muted/40 p-4 text-sm">{HEALTH_FORM_INTRO}</p>

      <Card>
        <CardHeader>
          <CardTitle>1. You and your emergency contacts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="hh_dob">Date of birth</Label>
            <Input id="hh_dob" type="date" value={form.dateOfBirth} onChange={onText("dateOfBirth")} />
          </div>
          <ContactFields
            title="Emergency contact"
            idPrefix="hh_ec1"
            name={form.emergencyContactName}
            phone={form.emergencyContactPhone}
            relationship={form.emergencyContactRelationship}
            onName={onText("emergencyContactName")}
            onPhone={onPhone("emergencyContactPhone")}
            onRelationship={onText("emergencyContactRelationship")}
          />
          <ContactFields
            title="Second emergency contact"
            idPrefix="hh_ec2"
            name={form.emergencyContact2Name}
            phone={form.emergencyContact2Phone}
            relationship={form.emergencyContact2Relationship}
            onName={onText("emergencyContact2Name")}
            onPhone={onPhone("emergencyContact2Phone")}
            onRelationship={onText("emergencyContact2Relationship")}
          />
          <p className="text-xs text-muted-foreground">
            These also update the emergency contacts on your profile, which event staff see at
            check-in.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Insurance</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="hh_carrier">Health insurance carrier</Label>
            <Input id="hh_carrier" value={form.insuranceCarrier} onChange={onText("insuranceCarrier")} placeholder="Write None if uninsured" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hh_policy">Policy number</Label>
            <Input id="hh_policy" value={form.insurancePolicyNumber} onChange={onText("insurancePolicyNumber")} placeholder="Write N/A if uninsured" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Conditions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm font-medium">
            Have you had, or do you currently have, any of the following?
          </p>
          {HEALTH_CONDITION_GROUPS.map((group) => (
            <fieldset key={group.title} className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">{group.title}</legend>
              {group.conditions.map((condition) => (
                <label key={condition.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.conditions.includes(condition.key)}
                    onCheckedChange={(c) => toggleCondition(condition.key, c === true)}
                  />
                  {condition.label}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="hh_other">Other (optional)</Label>
            <Input
              id="hh_other"
              value={form.conditionsOther}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  conditionsOther: e.target.value,
                  noConditions: e.target.value.trim() ? false : prev.noConditions,
                }))
              }
            />
          </div>
          <label className="flex items-center gap-2 border-t pt-3 text-sm font-medium">
            <Checkbox
              checked={form.noConditions}
              onCheckedChange={(c) =>
                setForm((prev) =>
                  c === true
                    ? { ...prev, noConditions: true, conditions: [], conditionsOther: "" }
                    : { ...prev, noConditions: false },
                )
              }
            />
            None of the above
          </label>
        </CardContent>
      </Card>

      {(followUps.size > 0 || needsExplanation) && (
        <Card>
          <CardHeader>
            <CardTitle>4. About what you checked</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {followUps.has("cardiac") && (
              <div className="flex flex-col gap-3">
                <YesNoField
                  name="hh_cardiac_cleared"
                  label="Heart and circulation: has a physician cleared you for moderate physical activity?"
                  value={form.cardiacPhysicianCleared}
                  onChange={set("cardiacPhysicianCleared")}
                />
                <TextArea
                  id="hh_cardiac_details"
                  label="Tell us more (optional)"
                  value={form.cardiacDetails}
                  onChange={onText("cardiacDetails")}
                />
              </div>
            )}
            {followUps.has("seizure") && (
              <div className="grid gap-2 sm:max-w-xs">
                <Label htmlFor="hh_seizure">Seizures: date of your most recent seizure</Label>
                <Input id="hh_seizure" value={form.seizureMostRecent} onChange={onText("seizureMostRecent")} placeholder="e.g. March 2024" />
              </div>
            )}
            {followUps.has("diabetes") && (
              <div className="flex flex-col gap-3">
                <YesNoField
                  name="hh_insulin"
                  label="Diabetes: do you use insulin?"
                  value={form.diabetesUsesInsulin}
                  onChange={set("diabetesUsesInsulin")}
                />
                <TextArea id="hh_low" label="How do you handle a low?" value={form.diabetesLowPlan} onChange={onText("diabetesLowPlan")} />
              </div>
            )}
            {followUps.has("surgery") && (
              <div className="flex flex-col gap-3">
                <TextArea
                  id="hh_surgery"
                  label="Surgery or injury in the past 12 months: what was it, and when?"
                  value={form.surgeryDetails}
                  onChange={onText("surgeryDetails")}
                />
                <YesNoField
                  name="hh_surgery_cleared"
                  label="Have you been cleared by a physician?"
                  value={form.surgeryPhysicianCleared}
                  onChange={set("surgeryPhysicianCleared")}
                />
              </div>
            )}
            {followUps.has("sleep_apnea") && (
              <YesNoField
                name="hh_cpap"
                label="Sleep apnea: do you travel with a CPAP machine?"
                value={form.sleepApneaTravelsWithCpap}
                onChange={set("sleepApneaTravelsWithCpap")}
              />
            )}
            {needsExplanation && (
              <TextArea
                id="hh_explain"
                label="Please explain the other conditions you checked"
                value={form.conditionsExplanation}
                onChange={onText("conditionsExplanation")}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>5. Medications and critical items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextArea
            id="hh_meds"
            label="List all medications and dosages, or N/A"
            value={form.medications}
            onChange={onText("medications")}
          />
          <YesNoField name="hh_thinners" label="Are you on blood thinners?" value={form.onBloodThinners} onChange={set("onBloodThinners")} />
          <YesNoField
            name="hh_epi"
            label="Do you carry an EpiPen or rescue inhaler?"
            value={form.carriesEpipenOrInhaler}
            onChange={set("carriesEpipenOrInhaler")}
          />
          {form.carriesEpipenOrInhaler === "true" && (
            <YesNoField
              name="hh_epi_bring"
              label="Will you have it with you at the event?"
              value={form.willBringEpipenOrInhaler}
              onChange={set("willBringEpipenOrInhaler")}
            />
          )}
          <YesNoField
            name="hh_storage"
            label="Does any medication need refrigeration or secure storage?"
            value={form.medicationStorageNeeded}
            onChange={set("medicationStorageNeeded")}
          />
          {form.medicationStorageNeeded === "true" && (
            <TextArea id="hh_storage_details" label="Which, and how?" value={form.medicationStorageDetails} onChange={onText("medicationStorageDetails")} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>6. Allergies</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <TextArea
            id="hh_allergies"
            label="Medical allergies — drugs, insect stings, and foods that cause a severe reaction. Write None if you have none."
            value={form.medicalAllergies}
            onChange={onText("medicalAllergies")}
          />
          <p className="text-xs text-muted-foreground">
            Food preferences and non-medical dietary restrictions are collected when you register
            for an event, not here.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>7. Getting around on the water</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">{MOBILITY_INTRO}</p>
          {MOBILITY_QUESTIONS.map((q) => (
            <ChoiceField
              key={q.key}
              name={`hh_${q.key}`}
              label={q.label}
              options={ABILITY_OPTIONS}
              value={form[q.key]}
              onChange={(v) => setForm((prev) => ({ ...prev, [q.key]: v }))}
            />
          ))}
          <YesNoField
            name="hh_aid"
            label="Do you use a mobility aid, brace, or assistive device, or have you had a fall in the past year?"
            value={form.mobilityAidOrFall}
            onChange={set("mobilityAidOrFall")}
          />
          {form.mobilityAidOrFall === "true" && (
            <TextArea id="hh_aid_details" label="Please explain" value={form.mobilityAidDetails} onChange={onText("mobilityAidDetails")} />
          )}
          <ChoiceField
            name="hh_swim"
            label="Can you swim, and how comfortable are you in moving water?"
            options={SWIMMING_OPTIONS}
            value={form.swimming}
            onChange={(v) => setForm((prev) => ({ ...prev, swimming: v as HealthHistoryInput["swimming"] }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>8. Anything else</CardTitle>
        </CardHeader>
        <CardContent>
          <TextArea
            id="hh_else"
            label="Is there any other information our team should know that may affect your ability to participate? (optional)"
            value={form.anythingElse}
            onChange={onText("anythingElse")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>9. Consent and signature</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.consentEmergencyTreatment}
              onCheckedChange={(c) => set("consentEmergencyTreatment")(c === true)}
            />
            {CONSENT_EMERGENCY_TREATMENT}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.consentShareWithEms}
              onCheckedChange={(c) => set("consentShareWithEms")(c === true)}
            />
            {CONSENT_SHARE_WITH_EMS}
          </label>
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="hh_signature">Type your full name to sign</Label>
            <Input id="hh_signature" value={form.signedName} onChange={onText("signedName")} autoComplete="name" />
            <p className="text-xs text-muted-foreground">
              Signed today, for {year}. It covers events through December 31, {year}.
            </p>
          </div>
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
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Submitting..." : `Submit ${year} health form`}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ContactFields({
  title,
  idPrefix,
  name,
  phone,
  relationship,
  onName,
  onPhone,
  onRelationship,
}: {
  title: string;
  idPrefix: string;
  name: string;
  phone: string;
  relationship: string;
  onName: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhone: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRelationship: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_name`} className="text-xs">Name</Label>
          <Input id={`${idPrefix}_name`} value={name} onChange={onName} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_phone`} className="text-xs">Phone</Label>
          <Input id={`${idPrefix}_phone`} type="tel" value={phone} onChange={onPhone} placeholder="(303) 555-0100" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${idPrefix}_rel`} className="text-xs">Relationship</Label>
          <Input id={`${idPrefix}_rel`} value={relationship} onChange={onRelationship} placeholder="e.g. Spouse" />
        </div>
      </div>
    </fieldset>
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
    <ChoiceField
      name={name}
      label={label}
      options={[
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]}
      value={value}
      onChange={(v) => onChange(v as YesNo)}
      inline
    />
  );
}

function ChoiceField({
  name,
  label,
  options,
  value,
  onChange,
  inline = false,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  inline?: boolean;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className={inline ? "flex gap-6 text-sm" : "flex flex-col gap-2 text-sm"}>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextArea({
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
