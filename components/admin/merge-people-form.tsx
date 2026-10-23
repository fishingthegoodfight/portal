"use client";

import Link from "next/link";
import { useState } from "react";

import { mergePeopleAction } from "@/lib/actions/person-merge";
import { formatDateInZone } from "@/lib/format-date";
import type { MergeField, MergeSide } from "@/lib/person-merge";
import { cn } from "@/lib/utils";
import { RevealPanel } from "@/components/reveal-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Side = "a" | "b";

const other = (side: Side): Side => (side === "a" ? "b" : "a");
const day = (instant: string | null) => (instant ? formatDateInZone(instant, "America/Denver") : null);

function Choice({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-2 rounded-md border bg-background p-2",
        checked && "border-foreground",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} className="mt-1" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="flex min-w-0 flex-col break-words">{children}</span>
    </label>
  );
}

/**
 * The merge screen for two profiles of one person (admin_merge_people does
 * the work; see lib/actions/person-merge.ts). The admin picks which profile
 * stays, which email they sign in with, and, for every field the two
 * disagree on, which value to keep; each choice starts on the kept
 * profile's value unless that's blank. Confirmed by typing the email of the
 * profile that goes away.
 */
export function MergePeopleForm({
  a,
  b,
  fields,
  initialKeep,
  /** Set when the viewer is one of the two: that one has to stay. */
  viewerSide,
}: {
  a: MergeSide;
  b: MergeSide;
  fields: MergeField[];
  initialKeep: Side;
  viewerSide: Side | null;
}) {
  const sides = { a, b };
  const defaults = (keep: Side) =>
    Object.fromEntries(fields.map((f) => [f.key, keep === "a" ? f.defaultWhenKeepingA : f.defaultWhenKeepingB]));

  const [keep, setKeep] = useState<Side>(viewerSide ?? initialKeep);
  const [choices, setChoices] = useState<Record<string, Side>>(() => defaults(viewerSide ?? initialKeep));
  const [login, setLogin] = useState<Side>(viewerSide ?? initialKeep);
  const [volunteer, setVolunteer] = useState<Side>(viewerSide ?? initialKeep);
  const [typed, setTyped] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ warning: string | null } | null>(null);

  const kept = sides[keep];
  const merged = sides[other(keep)];
  const bothVolunteers = a.volunteerStatus != null && b.volunteerStatus != null;

  const pickKeep = (side: Side) => {
    setKeep(side);
    // Choices follow the kept profile; a fresh start is clearer than
    // carrying over picks made the other way round.
    setChoices(defaults(side));
    setLogin(side);
    setVolunteer(side);
    setTyped("");
    setError(null);
  };

  if (done) {
    return (
      <RevealPanel className="flex flex-col gap-3 rounded-md border p-4 text-sm">
        <p>
          Merged. <strong>{kept.name}</strong> has one profile now and signs in with{" "}
          <strong>{sides[login].email}</strong>.
        </p>
        {done.warning && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {done.warning}
          </p>
        )}
        <div>
          <Button asChild size="sm">
            <Link href={`/protected/admin/people/${kept.id}`}>Open their page</Link>
          </Button>
        </div>
      </RevealPanel>
    );
  }

  const blocked =
    a.hasOpenApplication && b.hasOpenApplication
      ? "Both have an open volunteer application. Withdraw one on Applications first, then merge."
      : null;
  // The merged profile's role only comes across when its access is picked.
  const takesMergedAccess = fields.some((f) => f.key === "access") && choices.access !== keep;
  const finalRole = takesMergedAccess ? merged.role : kept.role;
  const losesLastAdmin = finalRole !== "admin" && (kept.isLastAdmin || merged.isLastAdmin);
  const emailMatches = typed.trim().toLowerCase() === merged.email.trim().toLowerCase();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await mergePeopleAction({
      keepId: kept.id,
      mergeId: merged.id,
      confirmEmail: typed,
      fieldsFromMerged: fields.filter((f) => choices[f.key] !== keep).flatMap((f) => f.send),
      loginFromMerged: login !== keep,
      volunteerFromMerged: bothVolunteers && volunteer !== keep,
      notify,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone({ warning: result.warning });
  };

  const sectionTitle = "text-sm font-semibold";

  return (
    <div className="flex flex-col gap-6 text-sm">
      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Which profile stays?</h2>
        <p className="text-muted-foreground">
          Everything from the other one moves onto it: RSVPs, shifts, waivers, health forms, volunteer record,
          outreach. Then the other profile and its login are deleted.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const s = sides[side];
            return (
              <Choice
                key={side}
                name="merge_keep"
                checked={keep === side}
                onChange={() => pickKeep(side)}
                disabled={viewerSide != null && viewerSide !== side}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {keep === side ? <Badge variant="secondary">Stays</Badge> : <Badge variant="outline">Merged in</Badge>}
                  {s.accessRemovedAt && (
                    <Badge variant="outline" className="border-red-500/50 text-red-700 dark:text-red-400">
                      Access removed
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground">{s.email}</span>
                <span className="text-muted-foreground">
                  {[
                    s.createdAt && `Created ${day(s.createdAt)}`,
                    s.lastSignInAt ? `last signed in ${day(s.lastSignInAt)}` : "never signed in",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-1">
                  {s.attached.length === 0 ? "Nothing attached" : s.attached.join(" · ")}
                </span>
              </Choice>
            );
          })}
        </div>
        {viewerSide && (
          <p className="text-muted-foreground">Your own profile has to be the one that stays.</p>
        )}
        {kept.accessRemovedAt && (
          <p className="text-amber-700 dark:text-amber-400">
            {kept.name}&apos;s access has been removed, so the merged profile can&apos;t sign in either. Restore access
            afterwards if that&apos;s wrong.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Which email do they sign in with?</h2>
        <p className="text-muted-foreground">
          The login keeps that email&apos;s password, so they sign in exactly as they did with it. The other email
          stops working.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["a", "b"] as const).map((side) => (
            <Choice key={side} name="merge_login" checked={login === side} onChange={() => setLogin(side)}>
              <span className="font-medium">{sides[side].email}</span>
              <span className="text-muted-foreground">
                {sides[side].lastSignInAt ? `Last signed in ${day(sides[side].lastSignInAt)}` : "Never signed in"}
              </span>
            </Choice>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={sectionTitle}>Where they differ</h2>
        {fields.length === 0 ? (
          <p className="text-muted-foreground">Every profile field is the same on both.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Pick the value to keep. Fields that match, or are blank on both, aren&apos;t listed.
            </p>
            <div className="flex flex-col gap-3">
              {fields.map((f) => (
                <fieldset key={f.key} className="flex flex-col gap-1">
                  <legend className="mb-1 font-medium">{f.label}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["a", "b"] as const).map((side) => (
                      <Choice
                        key={side}
                        name={`merge_field_${f.key}`}
                        checked={choices[f.key] === side}
                        onChange={() => setChoices((c) => ({ ...c, [f.key]: side }))}
                      >
                        <span className={cn(!f[side] && "italic text-muted-foreground")}>{f[side] || "Blank"}</span>
                        <span className="text-xs text-muted-foreground">{sides[side].email}</span>
                      </Choice>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </>
        )}
      </section>

      {bothVolunteers && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionTitle}>Volunteer record</h2>
          <p className="text-muted-foreground">
            Both are volunteers. Pick whose status, dates and registration answers to keep. Role approvals,
            certifications and notes from both are kept either way.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["a", "b"] as const).map((side) => (
              <Choice key={side} name="merge_volunteer" checked={volunteer === side} onChange={() => setVolunteer(side)}>
                <span className="font-medium">{sides[side].volunteerStatus}</span>
                <span className="text-xs text-muted-foreground">{sides[side].email}</span>
              </Choice>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-md border border-red-500/50 bg-red-500/10 p-3">
        {blocked ? (
          <p role="alert">{blocked}</p>
        ) : (
          <>
            <p>
              <strong>{merged.name}</strong> ({merged.email}) will be merged into <strong>{kept.name}</strong> and
              deleted. Where both have an RSVP or shift for the same event, the further-along one stays. This
              can&apos;t be undone.
            </p>
            {losesLastAdmin && (
              <p className="text-red-700 dark:text-red-400">
                {kept.isLastAdmin ? kept.name : merged.name} is the only admin. Pick the admin&apos;s site role &
                access above, or the merge will be refused.
              </p>
            )}
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox className="mt-0.5" checked={notify} onCheckedChange={(c) => setNotify(c === true)} />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Email them about the merge</span>
                <span className="text-muted-foreground">
                  To both {a.email} and {b.email}: which email to sign in with, not to use the other one, and their
                  contact details as kept, with a link to fix anything wrong.
                </span>
              </span>
            </label>
            <div className="grid gap-2">
              <Label htmlFor="merge_confirm">
                Type <strong>{merged.email}</strong> to confirm
              </Label>
              <Input
                id="merge_confirm"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            {error && (
              <RevealPanel role="alert" revealKey={error} className="text-red-700 dark:text-red-400">
                {error}
              </RevealPanel>
            )}
            <div>
              <Button type="button" variant="destructive" disabled={!emailMatches || busy} onClick={submit}>
                {busy ? "Merging..." : "Merge profiles"}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
