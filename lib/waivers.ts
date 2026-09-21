import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAPTERS } from "@/lib/chapters";
import { formatDateInZone } from "@/lib/format-date";

/**
 * Liability waivers (tables `waivers` / `waiver_signatures`, see the
 * 2026-09-21 entry in schema-changes.sql).
 *
 * A participant needs a signature on the *active* waiver for the event's
 * waiver state and the event's calendar year. "Active" = the highest-version
 * row with is_active = true for that (state, year). Colorado and Georgia are
 * separate signatures; a new version or a new year means signing again.
 */

export const WAIVER_STATES = { CO: "Colorado", GA: "Georgia" } as const;
export type WaiverState = keyof typeof WAIVER_STATES;

export function isWaiverState(value: unknown): value is WaiverState {
  return value === "CO" || value === "GA";
}

/** The waiver state a chapter maps to (CO for Denver/CO Springs, GA for
 * Atlanta/Rome), or null for an unknown chapter. */
export function waiverStateForChapter(chapter: string | null | undefined): WaiverState | null {
  const state = CHAPTERS.find((c) => c.name === chapter)?.state;
  return isWaiverState(state) ? state : null;
}

export type ActiveWaiver = {
  id: number;
  state: WaiverState;
  year: number;
  version: number;
  title: string;
  body_markdown: string;
};

/** The subset of an event the waiver logic needs. */
export type WaiverEvent = {
  chapter: string | null;
  waiver_state: string | null;
  starts_at: string;
  timezone: string;
};

/** The event's calendar year in its own timezone — an event at 11pm on Dec 31
 * local time is still that year, whatever UTC says. */
export function eventYear(startsAt: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(new Date(startsAt)),
  );
}

/** events.waiver_state, falling back to the chapter's state for a row that
 * predates the column. Null when neither is known. */
export function waiverStateForEvent(event: WaiverEvent): WaiverState | null {
  return isWaiverState(event.waiver_state)
    ? event.waiver_state
    : waiverStateForChapter(event.chapter);
}

/** Highest-version active waiver for a state + year, or null if none exists. */
export async function loadActiveWaiver(
  supabase: SupabaseClient,
  state: WaiverState,
  year: number,
): Promise<ActiveWaiver | null> {
  const { data } = await supabase
    .from("waivers")
    .select("id, state, year, version, title, body_markdown")
    .eq("state", state)
    .eq("year", year)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ActiveWaiver | null) ?? null;
}

export type WaiverRequirement =
  | { kind: "no_state" }
  | { kind: "no_waiver"; state: WaiverState; year: number }
  | { kind: "ok"; state: WaiverState; year: number; waiver: ActiveWaiver };

/** Which waiver an event calls for (independent of who is signing it). */
export async function resolveEventWaiver(
  supabase: SupabaseClient,
  event: WaiverEvent,
): Promise<WaiverRequirement> {
  const state = waiverStateForEvent(event);
  if (!state) return { kind: "no_state" };
  const year = eventYear(event.starts_at, event.timezone);
  const waiver = await loadActiveWaiver(supabase, state, year);
  return waiver ? { kind: "ok", state, year, waiver } : { kind: "no_waiver", state, year };
}

/** One user's signature on one waiver, if any. Always filtered by user_id —
 * admins can read everyone's signatures, so RLS alone isn't enough. */
export async function loadSignature(
  supabase: SupabaseClient,
  userId: string,
  waiverId: number,
): Promise<{ signed_name: string; signed_at: string } | null> {
  const { data } = await supabase
    .from("waiver_signatures")
    .select("signed_name, signed_at")
    .eq("user_id", userId)
    .eq("waiver_id", waiverId)
    .maybeSingle();
  return (data as { signed_name: string; signed_at: string } | null) ?? null;
}

/** "Signed for 2026 (Colorado) on Sep 21, 2026" */
export function signedLabel(
  waiver: Pick<ActiveWaiver, "state" | "year">,
  signedAt: string,
  timeZone: string,
): string {
  return `Signed for ${waiver.year} (${WAIVER_STATES[waiver.state]}) on ${formatDateInZone(signedAt, timeZone)}`;
}

/** What an RSVP form needs to know about the event's waiver for this person. */
export type WaiverInfo =
  | { status: "signed"; label: string }
  | {
      status: "unsigned";
      waiverId: number;
      title: string;
      bodyMarkdown: string;
      heading: string;
    }
  | { status: "unavailable"; message: string };

export function waiverHeading(state: WaiverState, year: number): string {
  return `${year} ${WAIVER_STATES[state]} waiver`;
}

export async function waiverInfoForUser(
  supabase: SupabaseClient,
  event: WaiverEvent,
  /** Null when the signer has no account yet (a brand-new walk-up). */
  userId: string | null,
): Promise<WaiverInfo> {
  const requirement = await resolveEventWaiver(supabase, event);
  if (requirement.kind === "no_state") {
    return {
      status: "unavailable",
      message: "This event requires a waiver but no waiver state is set for it. Please contact an organizer.",
    };
  }
  if (requirement.kind === "no_waiver") {
    return {
      status: "unavailable",
      message: `This event requires a waiver, but no ${requirement.year} ${WAIVER_STATES[requirement.state]} waiver has been published yet. Please contact an organizer.`,
    };
  }

  const signature = userId ? await loadSignature(supabase, userId, requirement.waiver.id) : null;
  if (signature) {
    return {
      status: "signed",
      label: signedLabel(requirement.waiver, signature.signed_at, event.timezone),
    };
  }
  return {
    status: "unsigned",
    waiverId: requirement.waiver.id,
    title: requirement.waiver.title,
    bodyMarkdown: requirement.waiver.body_markdown,
    heading: waiverHeading(requirement.state, requirement.year),
  };
}
