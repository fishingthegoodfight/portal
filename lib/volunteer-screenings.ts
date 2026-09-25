/**
 * The screening call (table `volunteer_screenings`, see the 2026-09-25
 * "Screening call form v2" entry in schema-changes.sql): its script,
 * sections, rating descriptors and validation. Plain data, safe to import
 * from client components.
 *
 * Weighted by consequence, not topic. Each rated section has three levels,
 * each with a written descriptor shown next to the choice, plus an
 * independent Concern checkbox — a "meets expectations" can still carry a
 * worry, and that worry is the thing most worth capturing. There is no
 * total, score or average anywhere.
 *
 * Access (the raw screening flag AND being able to see the application) is
 * enforced in the database; the applicant never sees any of it.
 */

export const LEVELS = [
  { value: "needs_improvement", label: "Needs improvement" },
  { value: "meets", label: "Meets expectations" },
  { value: "excellent", label: "Excellent" },
] as const;
export type Level = (typeof LEVELS)[number]["value"];

export function levelLabel(value: string | null): string {
  return LEVELS.find((l) => l.value === value)?.label ?? "—";
}

/** Which applicants a section is for. */
export type Track = "everyone" | "retreat" | "chapter";

/** Where on the application a quoted answer comes from. */
export type ApplicationQuote =
  | "why_volunteer"
  | "hope_to_get"
  | "mission_connection"
  | "years_fly_fishing"
  | "fishing_frequency"
  | "water_fished"
  | "taught"
  | "beginner_comfort";

export type RatedSection = {
  /** Column prefix: `<key>_level`, `<key>_concern`, `<key>_notes`. */
  key: "why_here" | "struggling" | "fishing_skill" | "water_safety" | "chapter_help" | "working_with_us";
  title: string;
  minutes?: number;
  track: Track;
  /** The applicant's own answers, quoted beside the questions. */
  quotes?: ApplicationQuote[];
  ask?: string[];
  /** Asked only of retreat applicants, inside an everyone-section. */
  askRetreatOnly?: string[];
  /** Read aloud, set apart, with their own guidance. */
  scenarios?: { prompt: string; listenFor: string }[];
  scenarioInstruction?: string;
  listenFor?: string;
  /** Guidance for the screener, shown above the rating. */
  note?: string;
  /** Shown prominently: e.g. "this is the section to decline on". */
  emphasis?: string;
  /** A question to put to yourself right above the rating. */
  beforeRating?: string;
  descriptors: Record<Level, string>;
};

export const INTRO_SCRIPT =
  "Thanks for your interest in Fishing the Good Fight. This call is mostly about getting to know you, telling you how we actually operate, and making sure it's a good fit both ways. It's informal — feel free to just be yourself.";

/** Section 3's heading, over its two separately rated parts (3a, 3b). */
export const SECTION_3 = { title: "Section 3 — On the water", minutes: 11, who: "retreat applicants only" };

export const CLOSE_PROMPTS = [
  "Any questions for you?",
  "Confirm we can contact their references.",
  "They'll hear about next steps within a week.",
];

export const CLOSE_SCRIPT =
  "Really appreciate you taking the time. We'll follow up soon with next steps. Either way, thanks for being willing to be part of this.";

export const SECTIONS: RatedSection[] = [
  {
    key: "why_here",
    title: "Section 1 — Why you're here",
    minutes: 6,
    track: "everyone",
    quotes: ["why_volunteer", "hope_to_get", "mission_connection"],
    ask: [
      "What drew you to this?",
      "What about the mission lands for you personally?",
      "Is there anything going on in your life right now we should know about?",
    ],
    listenFor:
      "A reason that's about the guys; self-awareness about their own story and where it belongs; someone whose own thing is settled rather than live.",
    descriptors: {
      needs_improvement:
        "Mostly about them, or generic, or they're clearly in the middle of something raw and looking for somewhere to put it.",
      meets:
        "Real, specific reason; talks about the guys more than himself; whatever he's been through, he's on the other side of it.",
      excellent:
        "Knows exactly why he's here, can name what he'd offer, and is candid about where his own story helps and where it would get in the way.",
    },
  },
  {
    key: "struggling",
    title: "Section 2 — Being with someone who's struggling",
    minutes: 12,
    track: "everyone",
    note: "This is the core of the call.",
    scenarioInstruction: "Read these aloud. Don't rush them — let the silence sit.",
    scenarios: [
      {
        prompt: "You're on the river with a guy and he tells you his marriage is falling apart. What do you do?",
        listenFor:
          "Whether his reflex is to fix. The right instinct is to keep listening and stay there.",
      },
      {
        prompt: "That evening he asks you not to tell anyone what he said. What do you say?",
        listenFor:
          "Whether he promises blanket confidentiality. The right answer is close to \"I won't share it around, but if I'm worried about you I'm going to talk to staff\" — and that he doesn't find the question awkward.",
      },
      {
        prompt: "The next morning he tells you he's been thinking about ending his life. What do you do?",
        listenFor:
          "Stays with him, doesn't leave him alone, doesn't try to counsel him, gets a staff member now. Wrong answers are promising to keep it between them, trying to talk him out of it alone, or leaving him at the water to go find someone.",
      },
    ],
    descriptors: {
      needs_improvement:
        "Jumps to advice or problem-solving. Would promise to keep it secret. Or in scenario 3, would handle it himself, or leave the guy to go find help.",
      meets:
        "Listens rather than fixes. Wouldn't promise blanket confidentiality, even if he'd fumble saying so. In scenario 3, knows to get staff and stay with him.",
      excellent:
        "Comfortable sitting in it without filling the silence. Handles the confidentiality question cleanly and without discomfort. In scenario 3, stays put, keeps him company, gets staff, and doesn't treat it as a crisis for him to manage.",
    },
  },
  {
    key: "fishing_skill",
    title: "3a. Fishing skill and instruction",
    track: "retreat",
    quotes: ["years_fly_fishing", "fishing_frequency", "water_fished", "taught", "beginner_comfort"],
    ask: [
      "Walk me through your first ten minutes with a total beginner, before he ever gets in the water.",
      "What rod and setup would you hand him, and why that one?",
      "He's casting but slapping the water and getting no distance — what do you fix first?",
      "How do you decide what to tie on when you get to the river?",
      "He's been at it two hours and caught nothing — what now?",
    ],
    note:
      "These are diagnostic. A competent teacher answers concretely and in plain language. Someone who fishes well but can't teach answers in jargon or generalities. Someone who has overstated their experience gets vague fast, particularly on the casting fault and the fly selection.",
    descriptors: {
      needs_improvement:
        "Vague or jargon-heavy. Can't give a beginner sequence. Can't name a specific casting fault or fix. Fly selection is \"whatever's working.\" Would let a frustrated guy keep flailing.",
      meets:
        "Has a clear beginner sequence, can diagnose the common casting faults and fix one at a time, picks flies with stated reasons, and changes something when it isn't working.",
      excellent:
        "Teaches in a deliberate order with reasons for each step, diagnoses a fault and knows which single thing to correct first, explains fly choice in terms a beginner would understand, and treats a slow day as a coaching opportunity — moves him, changes the goal, makes the day feel like a success anyway.",
    },
  },
  {
    key: "water_safety",
    title: "3b. Safety judgment",
    track: "retreat",
    emphasis:
      "This is the section to decline on. Everything else can be coached; water judgment, in a weekend, cannot.",
    ask: [
      "What would you do if he wanted to wade somewhere you thought was unsafe?",
      "What are you watching for out there?",
      "How do you keep an eye on someone while you're also fishing?",
    ],
    beforeRating:
      "Before you rate — would you be comfortable with this person responsible for two guys in moving water, out of your sight?",
    descriptors: {
      needs_improvement:
        "General answers like \"just be careful.\" Can't name specific hazards. Or would let a participant talk him into it.",
      meets:
        "Names real hazards — current, footing, cold, depth, distance from help — and would stop someone, even if awkwardly.",
      excellent:
        "Names hazards and where he'd position himself relative to a participant. Turns someone back without taking his dignity. Notices how a guy is doing physically before he says anything.",
    },
  },
  {
    key: "chapter_help",
    title: "Section 2b — Helping at chapter events",
    minutes: 6,
    track: "chapter",
    ask: [
      "What kind of helping are you picturing?",
      "You've been to a few events — what did you notice about how they run?",
      "How are you in a room of people you don't know yet?",
    ],
    listenFor: "Reliability over enthusiasm; comfort with quiet guys; not needing to be at the center of it.",
    descriptors: {
      needs_improvement:
        "Vague about what they'd actually do, or describes a role that's mostly about being social and visible.",
      meets:
        "Concrete picture of helping, has paid attention at events, comfortable sitting with someone who isn't talking much.",
      excellent:
        "Notices the guy standing on his own and goes over. Talks about making the room work rather than being in it.",
    },
  },
  {
    key: "working_with_us",
    title: "Section 4 — Working with us",
    minutes: 4,
    track: "everyone",
    ask: [
      "Tell me about a time someone gave you feedback you didn't agree with.",
      "What would you do if you saw another volunteer crossing a line with a participant?",
    ],
    askRetreatOnly: ["You saw the retreat commitments on the application — any concerns?"],
    descriptors: {
      needs_improvement:
        "Defensive about feedback, or can't think of an example. Would handle a fellow volunteer's behavior himself, or say nothing.",
      meets: "Can take a correction. Would tell a staff member about a concern. Commitment is realistic.",
      excellent: "Describes changing his mind. Would raise something uncomfortable early and without drama.",
    },
  },
];

/** The sections a call covers, in order: section 3 (3a + 3b) for retreat
 * applicants, 2b in its place for chapter-only applicants. */
export function sectionsFor(retreatTrack: boolean): RatedSection[] {
  return SECTIONS.filter(
    (s) => s.track === "everyone" || (retreatTrack ? s.track === "retreat" : s.track === "chapter"),
  ).sort((a, b) => sectionOrder(a.key, retreatTrack) - sectionOrder(b.key, retreatTrack));
}

function sectionOrder(key: RatedSection["key"], retreatTrack: boolean): number {
  const order = retreatTrack
    ? ["why_here", "struggling", "fishing_skill", "water_safety", "working_with_us"]
    : ["why_here", "struggling", "chapter_help", "working_with_us"];
  return order.indexOf(key);
}

export const READS = [
  { key: "mission_aligned", label: "Mission-aligned" },
  { key: "emotionally_grounded", label: "Emotionally grounded" },
  { key: "coachable", label: "Coachable and humble" },
  { key: "right_fit_now", label: "Right fit right now" },
] as const;
export type ReadKey = (typeof READS)[number]["key"];
export const READ_VALUES = ["yes", "maybe", "no"] as const;
export type ReadValue = (typeof READ_VALUES)[number];

export const RECOMMENDED_ROLES_NOTE = "New retreat volunteers start as Fishing Instructor only.";

/** Next step — the same three outcomes (and status behaviour) as before. */
export const OUTCOMES = [
  { value: "advance", label: "Move forward to references" },
  { value: "hold", label: "Pause, revisit later" },
  { value: "decline", label: "Not a fit right now" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["value"];

export function outcomeLabel(value: string, isRecommendation = false): string {
  const label = OUTCOMES.find((o) => o.value === value)?.label ?? value;
  return value === "decline" && isRecommendation ? `${label} (recommended — for an admin to action)` : label;
}

export type ScreeningInput = {
  callDate: string;
  interviewerName: string;
  lengthMinutes: string;
  levels: Partial<Record<RatedSection["key"], Level | "">>;
  concerns: Partial<Record<RatedSection["key"], boolean>>;
  notes: Partial<Record<RatedSection["key"], string>>;
  reads: Partial<Record<ReadKey, ReadValue | "">>;
  recommendedRoleTypeIds: number[];
  outcome: Outcome | "";
  summary: string;
};

export function emptyScreening(interviewerName: string, today: string): ScreeningInput {
  return {
    callDate: today,
    interviewerName,
    lengthMinutes: "",
    levels: {},
    concerns: {},
    notes: {},
    reads: {},
    recommendedRoleTypeIds: [],
    outcome: "",
    summary: "",
  };
}

export function screeningErrors(input: ScreeningInput, retreatTrack: boolean): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.callDate)) errors.push("Give the date of the call");
  if (!input.interviewerName.trim()) errors.push("Say who ran the call");
  if (input.lengthMinutes.trim() && !/^\d{1,3}$/.test(input.lengthMinutes.trim())) {
    errors.push("Length should be a number of minutes");
  }
  const unrated = sectionsFor(retreatTrack).filter((s) => !input.levels[s.key]);
  if (unrated.length > 0) errors.push(`Rate every section (${unrated.map((s) => s.title).join("; ")} still to rate)`);
  if (READS.some((r) => !input.reads[r.key])) errors.push("Answer all four quick reads");
  if (!input.outcome) errors.push("Choose a next step");
  if (!input.summary.trim()) errors.push("Say why, in a few sentences");
  return errors;
}

/** A stored screening, as the volunteer_screenings row. */
export type ScreeningRecord = {
  id: number;
  application_id: number;
  call_date: string;
  interviewer_name: string;
  length_minutes: number | null;
  retreat_track: boolean;
  read_mission_aligned: ReadValue;
  read_emotionally_grounded: ReadValue;
  read_coachable: ReadValue;
  read_right_fit_now: ReadValue;
  recommended_role_type_ids: number[];
  outcome: Outcome;
  decline_is_recommendation: boolean;
  summary: string;
  recorded_by: string | null;
  recorded_at: string;
  updated_by: string | null;
  updated_at: string;
} & Record<string, unknown>;

export function levelOf(record: ScreeningRecord, key: RatedSection["key"]): Level | null {
  return (record[`${key}_level`] as Level | null | undefined) ?? null;
}
export function concernOf(record: ScreeningRecord, key: RatedSection["key"]): boolean {
  return Boolean(record[`${key}_concern`]);
}
export function notesOf(record: ScreeningRecord, key: RatedSection["key"]): string | null {
  return (record[`${key}_notes`] as string | null | undefined) ?? null;
}
export function readOf(record: ScreeningRecord, key: ReadKey): ReadValue {
  return record[`read_${key}`] as ReadValue;
}

/** A stored screening back into form state, for editing. */
export function screeningToInput(record: ScreeningRecord): ScreeningInput {
  const levels: ScreeningInput["levels"] = {};
  const concerns: ScreeningInput["concerns"] = {};
  const notes: ScreeningInput["notes"] = {};
  for (const s of sectionsFor(record.retreat_track)) {
    levels[s.key] = levelOf(record, s.key) ?? "";
    concerns[s.key] = concernOf(record, s.key);
    notes[s.key] = notesOf(record, s.key) ?? "";
  }
  const reads: ScreeningInput["reads"] = {};
  for (const r of READS) reads[r.key] = readOf(record, r.key);
  return {
    callDate: record.call_date,
    interviewerName: record.interviewer_name,
    lengthMinutes: record.length_minutes != null ? String(record.length_minutes) : "",
    levels,
    concerns,
    notes,
    reads,
    recommendedRoleTypeIds: record.recommended_role_type_ids ?? [],
    outcome: record.outcome,
    summary: record.summary ?? "",
  };
}

/** Statuses a screening can be recorded from: invited to schedule onward. */
export const SCREENABLE_STATUSES = [
  "invited_to_schedule",
  "screening_scheduled",
  "screened",
  "references_out",
  "references_in",
  "approved",
];
