/**
 * Practical instruction checks (table `practical_instruction_checks` — see
 * the 2026-09-25 "Screening call form v2 …" entry in schema-changes.sql):
 * 45 minutes on the water with an experienced instructor, the applicant
 * teaching the assessor as a beginner. Tied to the person, not a volunteer
 * record. The latest check is the one that counts; there's no expiry, so
 * every display shows when and by whom, for the reader to judge.
 *
 * Only a check recorded here counts. A reference's answers about someone's
 * fishing (lib/volunteer-references.ts) are reference signal — they may
 * suggest scheduling a check, or who should run it — and must never be read
 * as satisfying this requirement.
 */

export const PRACTICAL_OUTCOMES = [
  { value: "passed", label: "Passed" },
  { value: "needs_work", label: "Needs work, recheck" },
  { value: "not_ready", label: "Not ready" },
] as const;
export type PracticalOutcome = (typeof PRACTICAL_OUTCOMES)[number]["value"];

export function practicalOutcomeLabel(value: string): string {
  return PRACTICAL_OUTCOMES.find((o) => o.value === value)?.label ?? value;
}

export type PracticalCheck = {
  id: number;
  user_id: string;
  checked_on: string;
  assessor_name: string;
  outcome: PracticalOutcome;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

/** "2026-10-03" -> "Oct 3, 2026" (a plain date, no timezone shift). */
export function formatCheckDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** One line for anywhere the check appears: the latest outcome, when, by whom. */
export function practicalCheckSummary(latest: Pick<PracticalCheck, "outcome" | "checked_on" | "assessor_name"> | null): string {
  if (!latest) return "No practical instruction check yet";
  return `${practicalOutcomeLabel(latest.outcome)} — ${formatCheckDate(latest.checked_on)}, assessed by ${latest.assessor_name}`;
}

/** Newest first — the first is the one that counts. */
export function sortChecks(checks: PracticalCheck[]): PracticalCheck[] {
  return [...checks].sort((a, b) => b.checked_on.localeCompare(a.checked_on) || b.recorded_at.localeCompare(a.recorded_at));
}

/** The role types a practical check applies to — at an event that requires
 * health history. Same list as volunteer_signups_practical_check_guard in
 * the database. */
export const PRACTICAL_CHECK_ROLE_KEYS = ["fishing_instructor", "lead_fly_fishing_instructor"];
