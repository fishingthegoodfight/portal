"use client";

import {
  AVAILABILITY_OPTIONS,
  BEGINNER_COMFORT_LABELS,
  FISHING_FREQUENCY_OPTIONS,
  HELP_FREQUENCY_OPTIONS,
  YEARS_FLY_FISHING_OPTIONS,
  type ExperienceInput,
  type YesNo,
} from "@/lib/volunteer-applications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The fly fishing, certification and availability cards — on the volunteer
 * application and again on volunteer registration. One component, one set
 * of option lists (lib/volunteer-applications.ts) and one validator
 * (experienceErrors), so the two forms ask exactly the same thing.
 */
export function ExperienceFields({
  value,
  onChange,
  idPrefix,
}: {
  value: ExperienceInput;
  onChange: (patch: Partial<ExperienceInput>) => void;
  idPrefix: string;
}) {
  const onText =
    (key: keyof ExperienceInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ [key]: e.target.value });
  const setYesNo = (key: keyof ExperienceInput) => (v: YesNo) => onChange({ [key]: v });
  const id = (name: string) => `${idPrefix}_${name}`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Fly fishing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id={id("years")}
              label="How many years have you been fly fishing?"
              options={YEARS_FLY_FISHING_OPTIONS}
              value={value.yearsFlyFishing}
              onChange={onText("yearsFlyFishing")}
            />
            <Choice
              id={id("how_often")}
              label="How often do you fish now?"
              options={FISHING_FREQUENCY_OPTIONS}
              value={value.fishingFrequency}
              onChange={onText("fishingFrequency")}
            />
          </div>
          <Field id={id("water")} label="What water do you fish most?" value={value.waterFished} onChange={onText("waterFished")} />
          <YesNoField name={id("taught")} label="Have you taught or guided anyone?" value={value.hasTaughtOrGuided} onChange={setYesNo("hasTaughtOrGuided")} />
          {value.hasTaughtOrGuided === "true" && (
            <Area id={id("taught_details")} label="Tell us about it" value={value.taughtDetails} onChange={onText("taughtDetails")} />
          )}
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor={id("comfort")}>How comfortable would you be teaching a complete beginner?</Label>
            <Select id={id("comfort")} value={value.beginnerComfort} onChange={onText("beginnerComfort")}>
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
          <YesNoField name={id("cpr")} label="First Aid/CPR" value={value.certFirstAidCpr} onChange={setYesNo("certFirstAidCpr")} />
          {value.certFirstAidCpr === "true" && (
            <div className="sm:max-w-xs">
              <Field id={id("cpr_expires")} label="Expires" type="date" value={value.certFirstAidCprExpires} onChange={onText("certFirstAidCprExpires")} />
            </div>
          )}
          <YesNoField name={id("wfa")} label="Wilderness First Aid or WFR" value={value.certWfaWfr} onChange={setYesNo("certWfaWfr")} />
          <YesNoField name={id("ffi")} label="FFI casting instructor" value={value.certFfiCasting} onChange={setYesNo("certFfiCasting")} />
          <YesNoField name={id("guide")} label="Guide license" value={value.certGuideLicense} onChange={setYesNo("certGuideLicense")} />
          <Field id={id("cert_other")} label="Other (optional)" value={value.certOther} onChange={onText("certOther")} />
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
                    checked={value.availability.includes(option.value)}
                    onCheckedChange={(c) =>
                      onChange({
                        availability:
                          c === true
                            ? [...value.availability, option.value]
                            : value.availability.filter((a) => a !== option.value),
                      })
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Choice
            id={id("frequency")}
            label="Roughly how often could you help?"
            options={HELP_FREQUENCY_OPTIONS}
            value={value.frequency}
            onChange={onText("frequency")}
          />
        </CardContent>
      </Card>
    </>
  );
}

export function Field({
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

export function Choice({
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

export function Area({
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

export function YesNoField({
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
