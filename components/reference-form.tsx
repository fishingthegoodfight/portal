"use client";

import { useState } from "react";

import { submitReferenceAction } from "@/lib/actions/volunteer-references";
import {
  emptyReference,
  FISHED_WITH_OPTIONS,
  FISHING_ABILITY_OPTIONS,
  fishedWithThem,
  KNOWN_FOR_OPTIONS,
  RATING_QUESTIONS,
  RECOMMEND_OPTIONS,
  REFERENCE_QUESTIONS as Q,
  referenceErrors,
  TWO_PARTICIPANTS_OPTIONS,
  type RatingKey,
  type ReferenceInput,
  type ReferenceSlot,
} from "@/lib/volunteer-references";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The public reference form, reached by a one-use link (no login). Short on
 * purpose. Reference 1 (a current volunteer) also says which chapter and
 * what they've seen at events; for a retreat applicant, whether they've
 * fished together, and if so three more.
 */
export function ReferenceForm({
  token,
  applicantName,
  referenceName,
  slot,
  fishingQuestions,
  chapterOptions,
}: {
  token: string;
  applicantName: string;
  referenceName: string;
  slot: ReferenceSlot;
  fishingQuestions: boolean;
  /** Active chapters' names, for reference 1's chapter question. */
  chapterOptions: string[];
}) {
  const [form, setForm] = useState<ReferenceInput>(() => emptyReference(referenceName));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [closed, setClosed] = useState(false);
  const shape = { slot, fishingQuestions };

  const set = <K extends keyof ReferenceInput>(key: K) => (value: ReferenceInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const onText =
    (key: keyof ReferenceInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = referenceErrors(form, shape, chapterOptions);
    setErrors(problems);
    if (problems.length > 0) return;
    setSaving(true);
    const result = await submitReferenceAction(token, form);
    setSaving(false);
    if (result.ok) {
      setDone(true);
      window.scrollTo({ top: 0 });
      return;
    }
    setErrors([result.error]);
    if (result.closed) setClosed(true);
  };

  if (done) return <ReferenceThankYou />;

  const first = applicantName.split(/\s+/)[0] || applicantName;

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">A reference for {applicantName}</h1>
        <p className="text-sm text-muted-foreground">
          {applicantName} is applying to volunteer with Fishing the Good Fight and gave us your name. This
          takes about three minutes. Your answers go to the FTGF volunteer team, not to {first}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>You and {first}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="ref_name">{Q.name}</Label>
              <Input id="ref_name" autoComplete="name" value={form.name} onChange={onText("name")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ref_known_for">{Q.knownFor}</Label>
              <Select id="ref_known_for" value={form.knownFor} onChange={onText("knownFor")}>
                <option value="">Choose one</option>
                {KNOWN_FOR_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ref_how_know">{Q.howKnow}</Label>
            <Input id="ref_how_know" placeholder="e.g. we volunteer together, a friend from work" value={form.howKnow} onChange={onText("howKnow")} />
          </div>
          {slot === 1 && (
            <>
              <div className="grid gap-1 sm:max-w-xs">
                <Label htmlFor="ref_chapter">{Q.chapter}</Label>
                <Select id="ref_chapter" value={form.chapter} onChange={onText("chapter")}>
                  <option value="">Choose one</option>
                  {chapterOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <Area id="ref_seen" label={Q.seenAtEvents} value={form.seenAtEvents} onChange={onText("seenAtEvents")} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your read on {first}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {RATING_QUESTIONS.map((q) => (
            <RatingField
              key={q.key}
              name={q.key}
              label={q.label}
              low={q.low}
              high={q.high}
              value={form[q.key as RatingKey]}
              onChange={set(q.key as RatingKey)}
            />
          ))}
          <Area id="ref_pause" label={`${Q.givesPause} (optional)`} value={form.givesPause} onChange={onText("givesPause")} />
          <Choices name="ref_recommend" label={Q.recommend} options={RECOMMEND_OPTIONS} value={form.recommend} onChange={set("recommend")} />
        </CardContent>
      </Card>

      {slot === 1 && fishingQuestions && (
        <Card>
          <CardHeader>
            <CardTitle>On the water</CardTitle>
            <p className="text-sm text-muted-foreground">
              {first} would like to volunteer at our retreats, where new volunteers work with participants on the water.
              Plenty of volunteers have never fished with the person they&apos;re vouching for — &ldquo;No&rdquo; is a fine answer.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Choices name="ref_fished" label={Q.fishedWith} options={FISHED_WITH_OPTIONS} value={form.fishedWith} onChange={set("fishedWith")} inline />
            {fishedWithThem(form) && (
              <>
                <Choices
                  name="ref_ability"
                  label={Q.fishingAbility}
                  options={FISHING_ABILITY_OPTIONS}
                  value={form.fishingAbility}
                  onChange={set("fishingAbility")}
                  inline
                />
                <Area id="ref_teaching" label={`${Q.seenTeaching} (optional)`} value={form.seenTeaching} onChange={onText("seenTeaching")} />
                <Choices
                  name="ref_two"
                  label={Q.twoParticipants}
                  options={TWO_PARTICIPANTS_OPTIONS}
                  value={form.twoParticipants}
                  onChange={set("twoParticipants")}
                  inline
                />
                <Area id="ref_two_why" label={`${Q.twoParticipantsWhy} (optional)`} value={form.twoParticipantsWhy} onChange={onText("twoParticipantsWhy")} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Area id="ref_else" label={`${Q.anythingElse} (optional)`} value={form.anythingElse} onChange={onText("anythingElse")} />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.notImmediateFamily}
              onCheckedChange={(c) => set("notImmediateFamily")(c === true)}
            />
            {Q.notImmediateFamily}
          </label>
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
      {!closed && (
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Sending..." : "Send my answers"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function ReferenceThankYou() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">Thank you</h1>
      <p className="text-sm text-muted-foreground">
        We&apos;ve got your answers — thanks for taking the time. There&apos;s nothing else you need to do.
      </p>
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
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={3} value={value} onChange={onChange} />
    </div>
  );
}

function Choices({
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
      <div className={inline ? "flex flex-wrap gap-x-6 gap-y-2 text-sm" : "flex flex-col gap-2 text-sm"}>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 1–5, labelled at both ends. */
function RatingField({
  name,
  label,
  low,
  high,
  value,
  onChange,
}: {
  name: string;
  label: string;
  low: string;
  high: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-xs text-muted-foreground">{low}</span>
        {["1", "2", "3", "4", "5"].map((n) => (
          <label key={n} className="flex items-center gap-1">
            <input type="radio" name={name} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">{high}</span>
      </div>
    </fieldset>
  );
}
