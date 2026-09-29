
/**
 * Reference checks, phase 3 of volunteer applications (tables
 * `volunteer_reference_requests` and `volunteer_reference_tokens` — see the
 * 2026-09-28 "Volunteer applications, phase 3" entry in schema-changes.sql):
 * the short public form, its validation, and the reminder schedule. Plain
 * data, safe to import from client components.
 *
 * Reference 1 is a current FTGF volunteer; reference 2 can be anyone. For
 * an applicant who wants to volunteer at retreats, reference 1 is also asked
 * whether they've fished with them. That's reference signal only: it
 * informs whether to schedule a practical instruction check and who might
 * run it, and nothing in the code lets it stand in for one.
 */

/** A reference's slot: 1 = the current volunteer, 2 = anyone. */
export type ReferenceSlot = 1 | 2;

export function referenceSlotLabel(slot: number): string {
  return slot === 1 ? "Reference 1 (current volunteer)" : "Reference 2";
}

// ---- Reminder schedule ----------------------------------------------------------
// Weekly, counted from when this reference's request went out: reminders on
// days 7, 14 and 21, and on day 28 with still no answer the reference is
// flagged as needing a replacement. Days are Denver calendar dates. A manual
// "Send a reminder now" doesn't count toward the three or move the schedule.

export const REFERENCE_REMINDER_INTERVAL_DAYS = 7;
export const REFERENCE_MAX_REMINDERS = 3;
/** Day number (from the request) a reference is flagged as gone quiet. */
export const REFERENCE_GIVE_UP_DAY = REFERENCE_REMINDER_INTERVAL_DAYS * (REFERENCE_MAX_REMINDERS + 1);
/** How long we ask a reference to take, for the email's "by" date. */
export const REFERENCE_RESPONSE_DAYS = 7;

export const REFERENCE_ZONE = "America/Denver";

/** An instant's calendar date in Denver, as a day count (UTC days since the epoch). */
export function denverDayNumber(instant: Date): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: REFERENCE_ZONE,
  })
    .format(instant)
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole Denver days from `from` to `to`. */
export function daysBetween(from: Date, to: Date): number {
  return denverDayNumber(to) - denverDayNumber(from);
}

/** What the reminder job should do for one unanswered reference today:
 * send automatic reminder N, flag it as gone quiet, or nothing. At most one
 * step per run, and each step also waits a full week after the last
 * automatic reminder — so if the job misses some days, it picks up where it
 * left off a week at a time rather than sending two reminders on
 * consecutive days. (Manual reminders don't count here.) */
export function reminderStepDue(
  requestedAt: Date,
  remindersSent: number,
  lastReminderAt: Date | null,
  gaveUp: boolean,
  now: Date,
): { kind: "remind"; number: number } | { kind: "give_up" } | null {
  const days = daysBetween(requestedAt, now);
  const weekSinceLast = !lastReminderAt || daysBetween(lastReminderAt, now) >= REFERENCE_REMINDER_INTERVAL_DAYS;
  if (remindersSent < REFERENCE_MAX_REMINDERS) {
    const next = remindersSent + 1;
    return days >= next * REFERENCE_REMINDER_INTERVAL_DAYS && weekSinceLast ? { kind: "remind", number: next } : null;
  }
  return !gaveUp && days >= REFERENCE_GIVE_UP_DAY && weekSinceLast ? { kind: "give_up" } : null;
}

// ---- The form ---------------------------------------------------------------------

export const KNOWN_FOR_OPTIONS = [
  "Less than a year",
  "1–3 years",
  "3–5 years",
  "5–10 years",
  "More than 10 years",
] as const;

export const RATING_QUESTIONS = [
  {
    key: "ratingHardTime",
    column: "rating_hard_time",
    label: "Would you be comfortable with this person supporting someone going through a hard time?",
    low: "Not comfortable",
    high: "Very comfortable",
  },
  {
    key: "ratingReliable",
    column: "rating_reliable",
    label: "Are they reliable — do they show up when they say they will?",
    low: "Not reliable",
    high: "Completely reliable",
  },
  {
    key: "ratingJudgment",
    column: "rating_judgment",
    label: "How are their judgment and boundaries?",
    low: "A concern",
    high: "Excellent",
  },
] as const;
export type RatingKey = (typeof RATING_QUESTIONS)[number]["key"];

export const RECOMMEND_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "yes_with_reservations", label: "Yes, with reservations" },
  { value: "no", label: "No" },
] as const;

export const FISHED_WITH_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "briefly", label: "Only briefly" },
  { value: "no", label: "No" },
] as const;

export const FISHING_ABILITY_OPTIONS = [
  { value: "beginner", label: "Beginner" },
  { value: "competent", label: "Competent" },
  { value: "strong", label: "Strong" },
  { value: "expert", label: "Expert" },
] as const;

export const TWO_PARTICIPANTS_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "not_sure", label: "Not sure" },
  { value: "no", label: "No" },
] as const;

export const REFERENCE_QUESTIONS = {
  name: "Your name",
  howKnow: "How do you know them?",
  knownFor: "How long have you known them?",
  chapter: "Which chapter do you volunteer with?",
  seenAtEvents: "What have you seen them do at events?",
  givesPause: "Is there anything that gives you pause about them volunteering with us?",
  recommend: "Would you recommend them?",
  anythingElse: "Anything else we should know?",
  notImmediateFamily: "I'm not a member of this person's immediate family.",
  fishedWith: "Have you fished with them?",
  fishingAbility: "How would you describe their fly fishing ability?",
  seenTeaching: "Have you seen them help or teach someone less experienced? What did you notice?",
  twoParticipants: "Would you be comfortable with them responsible for two participants on the water?",
  twoParticipantsWhy: "Why?",
} as const;

export type ReferenceInput = {
  name: string;
  howKnow: string;
  knownFor: string;
  chapter: string;
  seenAtEvents: string;
  ratingHardTime: string;
  ratingReliable: string;
  ratingJudgment: string;
  givesPause: string;
  recommend: string;
  anythingElse: string;
  notImmediateFamily: boolean;
  fishedWith: string;
  fishingAbility: string;
  seenTeaching: string;
  twoParticipants: string;
  twoParticipantsWhy: string;
};

export function emptyReference(name: string): ReferenceInput {
  return {
    name,
    howKnow: "",
    knownFor: "",
    chapter: "",
    seenAtEvents: "",
    ratingHardTime: "",
    ratingReliable: "",
    ratingJudgment: "",
    givesPause: "",
    recommend: "",
    anythingElse: "",
    notImmediateFamily: false,
    fishedWith: "",
    fishingAbility: "",
    seenTeaching: "",
    twoParticipants: "",
    twoParticipantsWhy: "",
  };
}

/** Which parts of the form this reference is asked. */
export type ReferenceFormShape = { slot: ReferenceSlot; fishingQuestions: boolean };

export function fishedWithThem(input: Pick<ReferenceInput, "fishedWith">): boolean {
  return input.fishedWith === "yes" || input.fishedWith === "briefly";
}

const oneOf = (value: string, options: readonly { value: string }[]) => options.some((o) => o.value === value);

/** Every problem with a reference's answers, in form order — one rule for the
 * form and the server action. Optional: what gives pause, anything else,
 * what they noticed teaching, and the "why". */
export function referenceErrors(
  input: ReferenceInput,
  shape: ReferenceFormShape,
  /** The chapters a reference 1 might volunteer with (active chapters'
   * names — referenceChapterOptions). */
  chapterOptions: string[],
): string[] {
  const errors: string[] = [];
  const blank = (v: string) => !v.trim();
  if (blank(input.name)) errors.push("Give your name");
  if (blank(input.howKnow)) errors.push("Say how you know them");
  if (!(KNOWN_FOR_OPTIONS as readonly string[]).includes(input.knownFor)) errors.push("Say how long you've known them");
  if (shape.slot === 1) {
    if (!chapterOptions.includes(input.chapter)) errors.push("Choose the chapter you volunteer with");
    if (blank(input.seenAtEvents)) errors.push("Tell us what you've seen them do at events");
  }
  if (RATING_QUESTIONS.some((q) => !["1", "2", "3", "4", "5"].includes(input[q.key]))) {
    errors.push("Answer each of the three 1–5 questions");
  }
  if (!oneOf(input.recommend, RECOMMEND_OPTIONS)) errors.push("Say whether you'd recommend them");
  if (shape.slot === 1 && shape.fishingQuestions) {
    if (!oneOf(input.fishedWith, FISHED_WITH_OPTIONS)) errors.push("Say whether you've fished with them");
    else if (fishedWithThem(input)) {
      if (!oneOf(input.fishingAbility, FISHING_ABILITY_OPTIONS)) errors.push("Describe their fly fishing ability");
      if (!oneOf(input.twoParticipants, TWO_PARTICIPANTS_OPTIONS)) {
        errors.push("Say whether you'd be comfortable with them responsible for two participants");
      }
    }
  }
  if (!input.notImmediateFamily) errors.push("Confirm you're not a member of their immediate family");
  return errors;
}

/** The answers as the database function takes them (reference_form_submit),
 * with anything that doesn't apply left out. */
export function referenceAnswersPayload(input: ReferenceInput, shape: ReferenceFormShape): Record<string, unknown> {
  const fishing = shape.slot === 1 && shape.fishingQuestions;
  const fished = fishing && fishedWithThem(input);
  return {
    name: input.name.trim(),
    how_know: input.howKnow.trim(),
    known_for: input.knownFor,
    chapter: shape.slot === 1 ? input.chapter : null,
    seen_at_events: shape.slot === 1 ? input.seenAtEvents.trim() : null,
    rating_hard_time: Number(input.ratingHardTime),
    rating_reliable: Number(input.ratingReliable),
    rating_judgment: Number(input.ratingJudgment),
    gives_pause: input.givesPause.trim(),
    recommend: input.recommend,
    anything_else: input.anythingElse.trim(),
    not_immediate_family: input.notImmediateFamily,
    fished_with: fishing ? input.fishedWith : null,
    fishing_ability: fished ? input.fishingAbility : null,
    seen_teaching: fished ? input.seenTeaching.trim() : null,
    comfortable_two_participants: fished ? input.twoParticipants : null,
    comfortable_two_participants_why: fished ? input.twoParticipantsWhy.trim() : null,
  };
}

// ---- Stored requests ---------------------------------------------------------------

/** A volunteer_reference_requests row. */
export type ReferenceRequest = {
  id: number;
  application_id: number;
  slot: ReferenceSlot;
  name: string;
  email: string;
  relationship: string | null;
  matched_volunteer: boolean;
  requested_at: string;
  requested_by: string | null;
  reminders_sent: number;
  last_reminder_at: string | null;
  manual_reminders_sent: number;
  last_manual_reminder_at: string | null;
  gave_up_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  submitted_at: string | null;
  answer_name: string | null;
  answer_how_know: string | null;
  answer_known_for: string | null;
  answer_chapter: string | null;
  answer_seen_at_events: string | null;
  rating_hard_time: number | null;
  rating_reliable: number | null;
  rating_judgment: number | null;
  answer_gives_pause: string | null;
  answer_recommend: string | null;
  answer_anything_else: string | null;
  answer_not_immediate_family: boolean | null;
  fished_with: string | null;
  fishing_ability: string | null;
  answer_seen_teaching: string | null;
  comfortable_two_participants: string | null;
  comfortable_two_participants_why: string | null;
};

const labelFrom = (options: readonly { value: string; label: string }[], value: string | null) =>
  value ? (options.find((o) => o.value === value)?.label ?? value) : null;

/** A received reference's answers as label/value lines for the review
 * screen, in form order. The fishing answers come separately
 * (referenceFishingAnswerRows) so they can carry their caveat. */
export function referenceAnswerRows(r: ReferenceRequest): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: REFERENCE_QUESTIONS.name, value: r.answer_name },
    { label: REFERENCE_QUESTIONS.howKnow, value: r.answer_how_know },
    { label: REFERENCE_QUESTIONS.knownFor, value: r.answer_known_for },
    ...(r.slot === 1
      ? [
          { label: REFERENCE_QUESTIONS.chapter, value: r.answer_chapter },
          { label: REFERENCE_QUESTIONS.seenAtEvents, value: r.answer_seen_at_events },
        ]
      : []),
    ...RATING_QUESTIONS.map((q) => ({
      label: q.label,
      value: r[q.column] != null ? `${r[q.column]} of 5` : null,
    })),
    { label: REFERENCE_QUESTIONS.givesPause, value: r.answer_gives_pause ?? "Nothing given" },
    { label: REFERENCE_QUESTIONS.recommend, value: labelFrom(RECOMMEND_OPTIONS, r.answer_recommend) },
    { label: REFERENCE_QUESTIONS.anythingElse, value: r.answer_anything_else ?? "Nothing given" },
    { label: "Not immediate family", value: r.answer_not_immediate_family ? "Confirmed" : null },
  ];
  return rows.filter((row): row is { label: string; value: string } => row.value != null);
}

export function referenceFishingAnswerRows(r: ReferenceRequest): { label: string; value: string }[] {
  if (!r.fished_with) return [];
  const rows: { label: string; value: string | null }[] = [
    { label: REFERENCE_QUESTIONS.fishedWith, value: labelFrom(FISHED_WITH_OPTIONS, r.fished_with) },
    { label: REFERENCE_QUESTIONS.fishingAbility, value: labelFrom(FISHING_ABILITY_OPTIONS, r.fishing_ability) },
    { label: REFERENCE_QUESTIONS.seenTeaching, value: r.fished_with === "no" ? null : (r.answer_seen_teaching ?? "Nothing given") },
    {
      label: REFERENCE_QUESTIONS.twoParticipants,
      value: labelFrom(TWO_PARTICIPANTS_OPTIONS, r.comfortable_two_participants),
    },
    { label: REFERENCE_QUESTIONS.twoParticipantsWhy, value: r.comfortable_two_participants_why },
  ];
  return rows.filter((row): row is { label: string; value: string } => row.value != null);
}

/** "Monday, October 5": the date we ask a reference to answer by, a week from `from`. */
export function referenceByDate(from: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: REFERENCE_ZONE,
  }).format(new Date(from.getTime() + REFERENCE_RESPONSE_DAYS * 86_400_000));
}
