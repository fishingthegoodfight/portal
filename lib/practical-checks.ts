/**
 * Practical instruction checks (table `practical_instruction_checks` — see
 * the 2026-09-25 "Screening call form v2 …" entry in schema-changes.sql):
 * 45 minutes on the water with an experienced instructor, the applicant
 * teaching the assessor as a beginner. Tied to the person, not a volunteer
 * record. The latest check is the one that counts; there's no expiry, so
 * every display shows when and by whom, for the reader to judge.
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
