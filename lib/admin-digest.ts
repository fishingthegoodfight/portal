import type { createAdminClient } from "@/lib/supabase/admin";
import type { AdminDigestSection } from "@/lib/email/templates";
import { getSiteUrl } from "@/lib/site-url";
import { formatDateInZone } from "@/lib/format-date";
import { formatCheckDate } from "@/lib/practical-checks";
import { daysBetween, REFERENCE_MAX_REMINDERS } from "@/lib/volunteer-references";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The daily admin digest (app/api/cron/admin-digest): one email listing
 * everything that needs an admin's attention, section by section. Each
 * source returns its section plus how to mark its items as sent, so nothing
 * is listed twice and nothing is marked unless the email actually went out.
 *
 * To add a section, write another DigestSource and add it to DIGEST_SOURCES in the order it should appear.
 * A source whose items should be listed only once (a new arrival) marks them
 * in markSent; one that's a standing reminder (still waiting on someone)
 * leaves markSent empty and is listed every day until it's dealt with.
 */
export type DigestSource = (admin: AdminClient) => Promise<{
  section: AdminDigestSection;
  markSent: () => Promise<void>;
}>;

/** Applications that moved from "Waiting on attendance" to "Ready to screen" on
 * their own since the last digest. */
const readyApplications: DigestSource = async (admin) => {
  const { data, error } = await admin.rpc("digest_ready_applications");
  if (error) throw new Error(`digest_ready_applications: ${error.message}`);
  const rows = (data ?? []) as {
    id: number;
    full_name: string;
    chapters: string[];
    ready_since: string;
    attended: number;
  }[];
  return {
    section: {
      title: "Applications now ready to screen",
      intro: "They've reached the events-attended minimum since applying. Invite them to schedule a call when you're ready.",
      items: rows.map((row) => ({
        label: row.full_name,
        detail: `${row.chapters.join(", ")} · ${row.attended} events attended · ready ${formatDateInZone(row.ready_since, "America/Denver")}`,
        url: `${getSiteUrl()}/protected/admin/applications/${row.id}`,
      })),
    },
    markSent: async () => {
      if (rows.length === 0) return;
      const { error: markError } = await admin
        .from("volunteer_applications")
        .update({ digest_notified_at: new Date().toISOString() })
        .in(
          "id",
          rows.map((r) => r.id),
        );
      if (markError) throw new Error(`marking applications as digested: ${markError.message}`);
    },
  };
};

type ScreenedRow = {
  id: number;
  full_name: string;
  chapters: string[];
  screened_since: string;
  decline_recommended: boolean;
  /** The latest call's "Pause, revisit later" date; null if it wasn't a pause. */
  revisit_on: string | null;
  /** revisit_on has arrived (Denver date). */
  revisit_due: boolean;
};

async function loadScreened(admin: AdminClient): Promise<ScreenedRow[]> {
  const { data, error } = await admin.rpc("digest_screened_applications");
  if (error) throw new Error(`digest_screened_applications: ${error.message}`);
  return (data ?? []) as ScreenedRow[];
}

function daysSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "since today" : `for ${days} ${days === 1 ? "day" : "days"}`;
}

/** Screened applications whose latest call recommends declining — only an
 * admin can decline. Listed every day until actioned. Never says what the
 * outcome was: recipients may not have the screening flag. */
const screeningDecisions: DigestSource = async (admin) => {
  const rows = (await loadScreened(admin)).filter((r) => r.decline_recommended);
  return {
    section: {
      title: "Screening calls needing an admin decision",
      intro: "Open each one to see the screening call (needs volunteer-screening access).",
      items: rows.map((row) => ({
        label: row.full_name,
        detail: `${row.chapters.join(", ")} · screened ${daysSince(row.screened_since)}`,
        url: `${getSiteUrl()}/protected/admin/applications/${row.id}`,
      })),
    },
    markSent: async () => {},
  };
};

/** Paused on the call ("Pause, revisit later") and the revisit date has
 * come. Listed every day from that date until someone acts — a new call,
 * references sent, or a decline. Before the date, a paused application is
 * in no section at all. */
const pausedToRevisit: DigestSource = async (admin) => {
  const rows = (await loadScreened(admin)).filter((r) => r.revisit_on != null && r.revisit_due);
  return {
    section: {
      title: "Paused applications to revisit",
      intro: "Paused after the screening call until now. Record another call, send references, or decline.",
      items: rows.map((row) => ({
        label: row.full_name,
        detail: `${row.chapters.join(", ")} · revisit from ${formatCheckDate(row.revisit_on as string)}`,
        url: `${getSiteUrl()}/protected/admin/applications/${row.id}`,
      })),
    },
    markSent: async () => {},
  };
};

/** Screened and waiting on references to be sent — so nothing stalls after
 * the call. Listed every day while it applies. Paused ones aren't waiting
 * on references. */
const screenedAwaitingReferences: DigestSource = async (admin) => {
  const rows = (await loadScreened(admin)).filter((r) => !r.decline_recommended && r.revisit_on == null);
  return {
    section: {
      title: "Screened, references not sent yet",
      items: rows.map((row) => ({
        label: row.full_name,
        detail: `${row.chapters.join(", ")} · screened ${daysSince(row.screened_since)}`,
        url: `${getSiteUrl()}/protected/admin/applications/${row.id}`,
      })),
    },
    markSent: async () => {},
  };
};

type OutstandingReferenceRow = {
  application_id: number;
  slot: number;
  name: string;
  requested_at: string;
  reminders_sent: number;
  manual_reminders_sent: number;
  gave_up_at: string | null;
  volunteer_applications: { full_name: string; chapters: string[] } | null;
};

/** Live, unanswered reference requests on applications still waiting on
 * references, oldest first. */
async function loadOutstandingReferences(admin: AdminClient): Promise<OutstandingReferenceRow[]> {
  const { data, error } = await admin
    .from("volunteer_reference_requests")
    .select(
      "application_id, slot, name, requested_at, reminders_sent, manual_reminders_sent, gave_up_at, volunteer_applications!inner(full_name, chapters, status)",
    )
    .is("replaced_at", null)
    .is("submitted_at", null)
    .eq("volunteer_applications.status", "references_out")
    .order("requested_at");
  if (error) throw new Error(`loading outstanding references: ${error.message}`);
  return (data ?? []) as unknown as OutstandingReferenceRow[];
}

function referenceItem(row: OutstandingReferenceRow, extra: string) {
  const waiting = daysBetween(new Date(row.requested_at), new Date());
  const manual = row.manual_reminders_sent > 0 ? ` (+${row.manual_reminders_sent} by hand)` : "";
  return {
    label: `${row.volunteer_applications?.full_name ?? "An applicant"} — reference ${row.slot} (${row.name})`,
    detail: `waiting ${waiting} ${waiting === 1 ? "day" : "days"} · ${row.reminders_sent} of ${REFERENCE_MAX_REMINDERS} reminders${manual}${extra}`,
    url: `${getSiteUrl()}/protected/admin/applications/${row.application_id}`,
  };
}

/** Reference requests still out, reminders still going. Listed every day
 * until answered, replaced, or given up — this is the one that gets
 * forgotten. */
const outstandingReferences: DigestSource = async (admin) => {
  const rows = (await loadOutstandingReferences(admin)).filter((r) => r.gave_up_at == null);
  return {
    section: {
      title: "Reference requests still out",
      intro: "Reminders go out weekly, up to three. Nothing to do yet unless you want to nudge someone yourself.",
      items: rows.map((row) => referenceItem(row, "")),
    },
    markSent: async () => {},
  };
};

/** Gone quiet a week after the third reminder: needs a replacement from the
 * applicant. Listed every day until replaced (or answered after all). */
const referencesNeedingReplacement: DigestSource = async (admin) => {
  const rows = (await loadOutstandingReferences(admin)).filter((r) => r.gave_up_at != null);
  return {
    section: {
      title: "References that need a replacement",
      intro: `No answer after ${REFERENCE_MAX_REMINDERS} reminders, and no more are going out. Ask the applicant for someone else, then use "Replace this reference".`,
      items: rows.map((row) => referenceItem(row, ` · stopped ${formatDateInZone(row.gave_up_at as string, "America/Denver")}`)),
    },
    markSent: async () => {},
  };
};

/** Both references in, not yet marked reviewed. Listed every day until an
 * admin does. */
const referencesToReview: DigestSource = async (admin) => {
  const { data, error } = await admin
    .from("volunteer_applications")
    .select("id, full_name, chapters, status_changed_at")
    .eq("status", "references_in")
    .is("references_reviewed_at", null)
    .order("status_changed_at");
  if (error) throw new Error(`loading references to review: ${error.message}`);
  const rows = (data ?? []) as { id: number; full_name: string; chapters: string[]; status_changed_at: string }[];
  return {
    section: {
      title: "References in, ready to review",
      intro: "Both references have answered. Read them and mark them reviewed — the step before approval.",
      items: rows.map((row) => ({
        label: row.full_name,
        detail: `${row.chapters.join(", ")} · in ${daysSince(row.status_changed_at)}`,
        url: `${getSiteUrl()}/protected/admin/applications/${row.id}`,
      })),
    },
    markSent: async () => {},
  };
};

/** In the order the sections appear — most pressing first. */
export const DIGEST_SOURCES: DigestSource[] = [
  readyApplications,
  screeningDecisions,
  referencesNeedingReplacement,
  referencesToReview,
  pausedToRevisit,
  screenedAwaitingReferences,
  outstandingReferences,
];
