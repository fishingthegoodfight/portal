"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  approveScholarshipAction,
  referPartnerAction,
  saveTherapistAction,
  setSupportStatusAction,
  type DecisionResult,
  type TherapistInput,
} from "@/lib/actions/therapy-admin";
import {
  formatCents,
  formatMonth,
  SESSIONS_PER_APPROVAL,
  STATUS_LABELS,
  type BudgetSummary,
  type PartnerUsage,
  type SupportProgram,
  type SupportStatus,
  type Therapist,
} from "@/lib/therapy-support";
import { US_STATE_NAMES } from "@/lib/us-states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NEW_THERAPIST = "new";

/** The therapist record that looks like the one the participant named: the
 * same email, or failing that the same name. */
function suggestedTherapist(therapists: Therapist[], given: TherapistInput): Therapist | undefined {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return (
    (given.email && therapists.find((t) => norm(t.email) === norm(given.email))) ||
    therapists.find((t) => norm(t.name) === norm(given.name))
  );
}

/**
 * The decision on one request. Scholarship: pick or create the therapist,
 * confirm they agreed to the flat rate, approve 12 sessions. Partner office:
 * refer (the database waitlists them for next month instead if this month's
 * sessions are used up). With no check-ins, either needs an override reason.
 * Every status change emails the participant (discreetly).
 */
export function TherapyReviewPanel({
  requestId,
  program,
  status,
  checkins,
  savedOverrideReason,
  therapists,
  therapistId,
  given,
  rateCents,
  usage,
  budget,
}: {
  requestId: number;
  program: SupportProgram;
  status: SupportStatus;
  checkins: number;
  savedOverrideReason: string | null;
  therapists: Therapist[];
  /** Already linked (a renewal carries it over). */
  therapistId: number | null;
  /** The therapist as the participant gave it, to prefill a new record. */
  given: TherapistInput;
  /** therapy_settings.scholarship_rate_cents; null = not set. */
  rateCents: number | null;
  usage: PartnerUsage | null;
  /** This year's scholarship budget (an approval counts against it). */
  budget: BudgetSummary | null;
}) {
  const router = useRouter();
  const suggestion = therapistId ? therapists.find((t) => t.id === therapistId) : suggestedTherapist(therapists, given);
  const [choice, setChoice] = useState<string>(suggestion ? String(suggestion.id) : NEW_THERAPIST);
  const [draft, setDraft] = useState<TherapistInput>(given);
  const [rateAgreed, setRateAgreed] = useState(false);
  const [overrideReason, setOverrideReason] = useState(savedOverrideReason ?? "");
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [overBudgetOk, setOverBudgetOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const deciding = status === "submitted" || status === "waitlisted";
  const needsOverride = checkins === 0;
  // What approving would commit, against what's left of this year's budget.
  const commits = rateCents === null ? 0 : rateCents * SESSIONS_PER_APPROVAL;
  const remaining = budget?.remaining_cents ?? null;
  const overBudget = program === "scholarship" && (remaining === null || commits > remaining);

  const done = (result: DecisionResult) => {
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const s = result.data.status;
    setNotice(
      `${STATUS_LABELS[s]}${s === "waitlisted" && program === "partner" ? " for next month: this month's sessions are used up" : ""}. ${
        result.data.emailed ? "They've been emailed." : "No email was sent."
      }`,
    );
    setConfirmingDecline(false);
    router.refresh();
  };

  const run = async (fn: () => Promise<DecisionResult>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    done(await fn());
  };

  const approveScholarship = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    let id = Number(choice);
    if (choice === NEW_THERAPIST) {
      const saved = await saveTherapistAction(null, draft);
      if (!saved.ok) {
        setBusy(false);
        setError(saved.error);
        return;
      }
      id = saved.data.id;
      setChoice(String(id));
    }
    done(await approveScholarshipAction(requestId, id, rateAgreed, overrideReason));
  };

  const setDraftField = (key: keyof TherapistInput, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  if (status === "approved") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Mark it complete if they&apos;ve stopped before using every session. (Once all{" "}
          {SESSIONS_PER_APPROVAL} are used, they can ask for a renewal from their Support page.)
        </p>
        {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setSupportStatusAction(requestId, "complete"))}>
            Mark complete
          </Button>
        </div>
      </div>
    );
  }

  if (!deciding) {
    return notice ? <p className="text-sm text-green-700 dark:text-green-400">{notice}</p> : null;
  }

  return (
    <div className="flex flex-col gap-4">
      {program === "scholarship" ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor="therapist_choice">Therapist record</Label>
            <Select id="therapist_choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value={NEW_THERAPIST}>Add a new therapist…</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {[t.name, t.practice, t.license_type && `${t.license_type}${t.license_state ? ` (${t.license_state})` : ""}`]
                    .filter(Boolean)
                    .join(" · ")}
                  {suggestion?.id === t.id ? " (matches their request)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {choice === NEW_THERAPIST && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <p className="text-xs text-muted-foreground sm:col-span-2">Filled in from what they gave us. Check it with the therapist.</p>
              {(
                [
                  ["name", "Name"],
                  ["practice", "Practice"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["licenseType", "License type"],
                ] as [keyof TherapistInput, string][]
              ).map(([key, label]) => (
                <div key={key} className="grid gap-1.5">
                  <Label htmlFor={`new_therapist_${key}`}>{label}</Label>
                  <Input id={`new_therapist_${key}`} value={draft[key]} onChange={(e) => setDraftField(key, e.target.value)} />
                </div>
              ))}
              <div className="grid gap-1.5">
                <Label htmlFor="new_therapist_licenseState">License state</Label>
                <Select id="new_therapist_licenseState" value={draft.licenseState} onChange={(e) => setDraftField("licenseState", e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(US_STATE_NAMES).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
          {rateCents === null ? (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              Set the scholarship flat rate in Settings &amp; access before approving.
            </p>
          ) : (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={rateAgreed} onCheckedChange={(c) => setRateAgreed(c === true)} />
              <span>
                The therapist has agreed to the flat rate of {formatCents(rateCents)} a session, with the
                participant paying them the rest directly.
              </span>
            </label>
          )}
          {rateCents !== null && budget && (
            <div
              className={
                overBudget
                  ? "flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
                  : "text-sm text-muted-foreground"
              }
            >
              <p>
                Approving commits {formatCents(commits)} ({SESSIONS_PER_APPROVAL} × {formatCents(rateCents)}).{" "}
                {remaining === null
                  ? `There's no ${budget.year} budget set yet.`
                  : `${formatCents(Math.max(remaining, 0))} of the ${budget.year} budget is left${
                      remaining < 0 ? ` (it's already ${formatCents(-remaining)} over)` : ""
                    }.`}
              </p>
              {overBudget && (
                <label className="flex items-start gap-2">
                  <Checkbox className="mt-0.5" checked={overBudgetOk} onCheckedChange={(c) => setOverBudgetOk(c === true)} />
                  <span>Approve anyway</span>
                </label>
              )}
            </div>
          )}
        </>
      ) : (
        usage && (
          <p className="text-sm text-muted-foreground">
            Partner office, {formatMonth(usage.month)}: {usage.used} of {usage.slots} sessions used.
            {usage.used >= usage.slots
              ? " This month is full, so referring them now waitlists them for next month."
              : ""}
          </p>
        )
      )}

      {needsOverride && (
        <div className="grid gap-2">
          <Label htmlFor="override_reason">Why approve without a check-in? (required)</Label>
          <Textarea id="override_reason" rows={2} maxLength={1000} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </div>
      )}

      {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {confirmingDecline ? (
        <div className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm">
          <p>Decline this request? They&apos;ll get an email saying it wasn&apos;t approved this time.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void run(() => setSupportStatusAction(requestId, "declined"))}>
              Yes, decline
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingDecline(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {program === "scholarship" ? (
            <Button
              type="button"
              size="sm"
              disabled={
                busy ||
                rateCents === null ||
                !rateAgreed ||
                (needsOverride && !overrideReason.trim()) ||
                (overBudget && !overBudgetOk)
              }
              onClick={() => void approveScholarship()}
            >
              {busy ? "Saving..." : `Approve ${SESSIONS_PER_APPROVAL} sessions`}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={busy || (needsOverride && !overrideReason.trim())}
              onClick={() => void run(() => referPartnerAction(requestId, overrideReason))}
            >
              {busy ? "Saving..." : "Refer to the partner office"}
            </Button>
          )}
          {program === "scholarship" && status === "submitted" && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setSupportStatusAction(requestId, "waitlisted"))}>
              Waitlist
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingDecline(true)}>
            Decline…
          </Button>
        </div>
      )}
    </div>
  );
}
