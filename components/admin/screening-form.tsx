"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { saveScreeningAction } from "@/lib/actions/volunteer-screenings";
import {
  CLOSE_PROMPTS,
  CLOSE_SCRIPT,
  INTRO_SCRIPT,
  LEVELS,
  OUTCOMES,
  READ_VALUES,
  READS,
  RECOMMENDED_ROLES_NOTE,
  SECTION_3,
  screeningErrors,
  sectionsFor,
  type ApplicationQuote,
  type Level,
  type RatedSection,
  type ScreeningInput,
} from "@/lib/volunteer-screenings";
import { BEGINNER_COMFORT_LABELS } from "@/lib/volunteer-applications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** What the screener has in front of them from the application. */
export type ScreeningReference = {
  interestAreaNames: string[];
  interestedInRetreats: boolean;
  attendedTotal: number;
  attendedEvents: { name: string; date: string }[];
  answers: {
    why_volunteer: string;
    hope_to_get: string;
    mission_connection: string | null;
    years_fly_fishing: string;
    fishing_frequency: string | null;
    water_fished: string;
    has_taught_or_guided: boolean;
    taught_details: string | null;
    beginner_comfort: number;
  };
};

const QUOTE_LABELS: Record<ApplicationQuote, string> = {
  why_volunteer: "Why do you want to volunteer?",
  hope_to_get: "What do you hope to get out of it?",
  mission_connection: "Anything about our mission that connects to your own story?",
  years_fly_fishing: "Years fly fishing",
  fishing_frequency: "How often do you fish now?",
  water_fished: "What water do you fish most?",
  taught: "Have you taught or guided anyone?",
  beginner_comfort: "Comfort teaching a complete beginner (their own rating)",
};

function quoteValue(ref: ScreeningReference, quote: ApplicationQuote): string {
  const a = ref.answers;
  switch (quote) {
    case "taught":
      return a.has_taught_or_guided ? `Yes — ${a.taught_details ?? ""}` : "No";
    case "beginner_comfort":
      return BEGINNER_COMFORT_LABELS[a.beginner_comfort] ?? String(a.beginner_comfort);
    case "fishing_frequency":
      return a.fishing_frequency ?? "(not asked — applied before this question existed)";
    case "mission_connection":
      return a.mission_connection ?? "(left blank)";
    default:
      return a[quote];
  }
}

/**
 * The screening call — laid out as the call runs, so it guides the
 * conversation as much as it records it. Each rated section shows the three
 * levels with their descriptors side by side and a separate Concern box.
 * Nothing is totalled.
 */
export function ScreeningForm({
  applicationId,
  screeningId,
  initial,
  retreatTrack,
  canDecline,
  reference,
  roleTypes,
}: {
  applicationId: number;
  /** null for a new call. */
  screeningId: number | null;
  initial: ScreeningInput;
  /** Section 3 (retreat) rather than 2b (chapter-only). */
  retreatTrack: boolean;
  /** An admin: "Not a fit" declines. Anyone else: it's a recommendation. */
  canDecline: boolean;
  reference: ScreeningReference;
  /** Active role types, for the recommendation. */
  roleTypes: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ScreeningInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const sections = sectionsFor(retreatTrack);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = screeningErrors(form, retreatTrack);
    setErrors(problems);
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const result = await saveScreeningAction(applicationId, screeningId, form);
      if (!result.ok) {
        setErrors([result.error]);
        return;
      }
      router.push(`/protected/admin/applications/${applicationId}`);
      router.refresh();
    } catch (err) {
      console.error("Save screening failed:", err);
      setErrors(["Couldn't reach the server. Check your connection and try again — nothing was lost."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Before the call</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <QuoteBlock
            items={[
              { label: "What they're interested in helping with", value: reference.interestAreaNames.join("\n") || "None picked" },
              { label: "Interested in retreat volunteering", value: reference.interestedInRetreats ? "Yes" : "No" },
            ]}
          />
          <div>
            <p className="font-medium">
              Events attended: {reference.attendedTotal}
            </p>
            {reference.attendedEvents.length > 0 ? (
              <ul className="text-muted-foreground">
                {reference.attendedEvents.map((e, i) => (
                  <li key={i}>
                    {e.name} · {e.date}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No check-ins recorded in the portal.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The call</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="scr_date" className="text-xs">Date</Label>
            <Input id="scr_date" type="date" value={form.callDate} onChange={(e) => setForm((p) => ({ ...p, callDate: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="scr_who" className="text-xs">Who ran it</Label>
            <Input id="scr_who" value={form.interviewerName} onChange={(e) => setForm((p) => ({ ...p, interviewerName: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="scr_length" className="text-xs">Length (minutes)</Label>
            <Input id="scr_length" inputMode="numeric" value={form.lengthMinutes} onChange={(e) => setForm((p) => ({ ...p, lengthMinutes: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intro · 2 min</CardTitle>
        </CardHeader>
        <CardContent>
          <Script>{INTRO_SCRIPT}</Script>
        </CardContent>
      </Card>

      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          {section.key === "fishing_skill" && (
            <h2 className="text-lg font-semibold">
              {SECTION_3.title} · {SECTION_3.minutes} min · {SECTION_3.who}
            </h2>
          )}
          <SectionCard
            section={section}
            reference={reference}
            retreatTrack={retreatTrack}
            level={form.levels[section.key] ?? ""}
            concern={form.concerns[section.key] === true}
            notes={form.notes[section.key] ?? ""}
            onLevel={(v) => setForm((p) => ({ ...p, levels: { ...p.levels, [section.key]: v } }))}
            onConcern={(v) => setForm((p) => ({ ...p, concerns: { ...p.concerns, [section.key]: v } }))}
            onNotes={(v) => setForm((p) => ({ ...p, notes: { ...p.notes, [section.key]: v } }))}
          />
        </div>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Close · 2 min</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="list-disc pl-5">
            {CLOSE_PROMPTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Script>{CLOSE_SCRIPT}</Script>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assessment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3">
            {READS.map((read) => (
              <fieldset key={read.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <legend className="w-48 font-medium">{read.label}</legend>
                {READ_VALUES.map((v) => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`scr_read_${read.key}`}
                      checked={form.reads[read.key] === v}
                      onChange={() => setForm((p) => ({ ...p, reads: { ...p.reads, [read.key]: v } }))}
                    />
                    {v[0].toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Recommended roles</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roleTypes.map((rt) => (
                <label key={rt.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.recommendedRoleTypeIds.includes(rt.id)}
                    onCheckedChange={(c) =>
                      setForm((p) => ({
                        ...p,
                        recommendedRoleTypeIds:
                          c === true ? [...p.recommendedRoleTypeIds, rt.id] : p.recommendedRoleTypeIds.filter((id) => id !== rt.id),
                      }))
                    }
                  />
                  {rt.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {RECOMMENDED_ROLES_NOTE} This is a recommendation for the approval step, not a decision.
            </p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Next step</legend>
            {OUTCOMES.map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="scr_outcome"
                  className="mt-1"
                  checked={form.outcome === o.value}
                  onChange={() => setForm((p) => ({ ...p, outcome: o.value }))}
                />
                <span>
                  {o.value === "decline" && !canDecline ? `${o.label} — as a recommendation` : o.label}
                  <span className="block text-xs text-muted-foreground">
                    {o.value !== "decline"
                      ? "Moves the application to Screened."
                      : canDecline
                        ? "Declines the application straight away. No email is sent — you'll let them know yourself."
                        : "Only an admin can decline. This goes to an admin as your recommendation; the application stays open until they act on it."}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="scr_summary">Why — a few sentences</Label>
            <Textarea id="scr_summary" value={form.summary} onChange={(e) => setForm((p) => ({ ...p, summary: e.target.value }))} />
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
          {saving ? "Saving..." : screeningId == null ? "Save screening" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SectionCard({
  section,
  reference,
  retreatTrack,
  level,
  concern,
  notes,
  onLevel,
  onConcern,
  onNotes,
}: {
  section: RatedSection;
  reference: ScreeningReference;
  retreatTrack: boolean;
  level: Level | "";
  concern: boolean;
  notes: string;
  onLevel: (v: Level) => void;
  onConcern: (v: boolean) => void;
  onNotes: (v: string) => void;
}) {
  return (
    <Card className={cn(section.emphasis && "border-2 border-red-600")}>
      <CardHeader>
        <CardTitle>
          {section.title}
          {section.minutes ? ` · ${section.minutes} min` : ""}
        </CardTitle>
        {section.note && section.key === "struggling" && (
          <p className="text-sm font-medium">{section.note}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {section.emphasis && (
          <p className="rounded-md bg-red-600 p-3 text-base font-semibold text-white">{section.emphasis}</p>
        )}

        {section.quotes && (
          <QuoteBlock items={section.quotes.map((q) => ({ label: QUOTE_LABELS[q], value: quoteValue(reference, q) }))} />
        )}

        {section.ask && (
          <div>
            <p className="font-medium">Ask</p>
            <ul className="list-disc pl-5">
              {section.ask.map((q) => (
                <li key={q}>{q}</li>
              ))}
              {retreatTrack && section.askRetreatOnly?.map((q) => <li key={q}>{q} <span className="text-xs text-muted-foreground">(retreat applicants)</span></li>)}
            </ul>
          </div>
        )}

        {section.scenarios && (
          <div className="flex flex-col gap-3">
            {section.scenarioInstruction && <p className="font-medium">{section.scenarioInstruction}</p>}
            {section.scenarios.map((sc, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Script>
                  <span className="not-italic font-semibold">Scenario {i + 1}: </span>
                  &ldquo;{sc.prompt}&rdquo;
                </Script>
                <p className="pl-4 text-muted-foreground">
                  <span className="font-medium text-foreground">Listening for: </span>
                  {sc.listenFor}
                </p>
              </div>
            ))}
          </div>
        )}

        {section.listenFor && (
          <p>
            <span className="font-medium">Listen for: </span>
            {section.listenFor}
          </p>
        )}
        {section.note && section.key !== "struggling" && (
          <p className="rounded-md bg-muted p-3">{section.note}</p>
        )}
        {section.beforeRating && <p className="font-semibold">{section.beforeRating}</p>}

        <fieldset className="grid gap-2" aria-label={`${section.title} rating`}>
          {LEVELS.map((l) => (
            <label
              key={l.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                level === l.value ? "border-foreground bg-accent" : "hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                className="mt-1"
                name={`scr_level_${section.key}`}
                checked={level === l.value}
                onChange={() => onLevel(l.value)}
              />
              <span>
                <span className="block font-semibold">{l.label}</span>
                <span className="text-muted-foreground">{section.descriptors[l.value]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 font-medium">
          <Checkbox checked={concern} onCheckedChange={(c) => onConcern(c === true)} />
          Concern — something here worries me, whatever the rating
        </label>
        <Textarea aria-label={`${section.title} notes`} placeholder="Notes" value={notes} onChange={(e) => onNotes(e.target.value)} />
      </CardContent>
    </Card>
  );
}

/** The applicant's own words, set apart from the questions. */
function QuoteBlock({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="rounded-md border-l-4 border-sky-500 bg-sky-500/5 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
        What they wrote on their application
      </p>
      <dl className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="whitespace-pre-line">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Text for the screener to read aloud or paraphrase. */
function Script({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="border-l-4 border-foreground/40 bg-muted/40 p-3 text-sm italic">{children}</blockquote>
  );
}
