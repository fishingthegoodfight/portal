import type { createClient } from "@/lib/supabase/server";
import type {
  AdminSupportRequest,
  AdminSupportRequestRow,
  OwnSupportRequest,
  PartnerUsage,
  Therapist,
  TherapySettings,
} from "@/lib/therapy-support";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The app's only way into Therapy Support data. The rule lives in the
 * database (the 2026-10-28 "Therapy Support, part 1" entry in
 * schema-changes.sql), never re-derived here:
 *
 *   can_manage_therapy_support() = an admin AND profiles.can_manage_therapy_support.
 *
 * No API role has any grant on the therapy_* tables, the service role
 * included, so nothing else in the app can read them even by mistake. Every
 * function below is a database function that checks the rule; the ones
 * that show a participant's record write therapy_access_log in the same call:
 *   - the request list: one "list" per load
 *   - one request opened: "view"
 *
 * Never call these from Members, rosters, the digests, exports outside
 * Therapy Support, or any screen a chapter lead or event lead can open.
 */

/** Whether the signed-in person may see Therapy Support at all. Not a read;
 * not logged. */
export async function canManageTherapySupport(supabase: SupabaseServerClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_manage_therapy_support");
  return !error && data === true;
}

/** The signed-in participant's own requests: status and sessions only. */
export async function loadMySupportRequests(supabase: SupabaseServerClient): Promise<OwnSupportRequest[]> {
  const { data, error } = await supabase.rpc("my_support_requests");
  if (error) {
    console.error(`[therapy access] own requests: ${error.message}`);
    return [];
  }
  return (
    (data ?? []) as {
      id: number;
      program: OwnSupportRequest["program"];
      status: OwnSupportRequest["status"];
      submitted_at: string;
      is_renewal: boolean;
      sessions_approved: number | null;
      sessions_used: number;
      can_renew: boolean;
    }[]
  ).map((r) => ({
    id: r.id,
    program: r.program,
    status: r.status,
    submittedAt: r.submitted_at,
    isRenewal: r.is_renewal,
    sessionsApproved: r.sessions_approved,
    sessionsUsed: r.sessions_used,
    canRenew: r.can_renew,
  }));
}

export type TherapyRead<T> = { ok: true; data: T } | { ok: false; error: string };

function failed<T>(error: { message: string } | null, what: string): TherapyRead<T> {
  console.error(`[therapy access] ${what}: ${error?.message ?? "no data"}`);
  return { ok: false, error: error?.message ?? "Couldn't load this" };
}

/** Every request, for the review list. Logs one "list". */
export async function loadSupportRequests(
  supabase: SupabaseServerClient,
): Promise<TherapyRead<AdminSupportRequestRow[]>> {
  const { data, error } = await supabase.rpc("therapy_admin_requests");
  if (error) return failed(error, "request list");
  return {
    ok: true,
    data: (
      (data ?? []) as {
        id: number;
        user_id: string | null;
        full_name: string;
        chapter: string | null;
        region: string | null;
        program: AdminSupportRequestRow["program"];
        status: AdminSupportRequestRow["status"];
        submitted_at: string;
        renewal_of: number | null;
        sessions_approved: number | null;
        sessions_used: number;
        checkins: number;
        last_checkin: string | null;
        prior_approvals: number;
        waitlist_month: string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      fullName: r.full_name,
      chapter: r.chapter,
      region: r.region,
      program: r.program,
      status: r.status,
      submittedAt: r.submitted_at,
      renewalOf: r.renewal_of,
      sessionsApproved: r.sessions_approved,
      sessionsUsed: r.sessions_used,
      checkins: r.checkins,
      lastCheckin: r.last_checkin,
      priorApprovals: r.prior_approvals,
      waitlistMonth: r.waitlist_month,
    })),
  };
}

/** One request in full, or null when there's no such request. Logs "view". */
export async function loadSupportRequest(
  supabase: SupabaseServerClient,
  id: number,
): Promise<TherapyRead<AdminSupportRequest | null>> {
  const { data, error } = await supabase.rpc("therapy_admin_request", { p_id: id });
  if (error) return failed(error, `request ${id}`);
  return { ok: true, data: (data as AdminSupportRequest | null) ?? null };
}

/** Every therapist record, for picking one on approval. Not participant
 * data; not logged. */
export async function loadTherapists(supabase: SupabaseServerClient): Promise<Therapist[]> {
  const { data, error } = await supabase.rpc("therapy_admin_therapists");
  if (error) {
    console.error(`[therapy access] therapists: ${error.message}`);
    return [];
  }
  return (data ?? []) as Therapist[];
}

export async function loadTherapySettings(supabase: SupabaseServerClient): Promise<TherapySettings | null> {
  const { data, error } = await supabase.rpc("therapy_admin_settings");
  if (error) {
    console.error(`[therapy access] settings: ${error.message}`);
    return null;
  }
  return data as TherapySettings;
}

/** The partner office this month: sessions logged against the monthly
 * number, and who's waitlisted for next month. */
export async function loadPartnerUsage(supabase: SupabaseServerClient): Promise<PartnerUsage | null> {
  const { data, error } = await supabase.rpc("therapy_partner_usage");
  if (error) {
    console.error(`[therapy access] partner usage: ${error.message}`);
    return null;
  }
  const row = ((data ?? []) as { month: string; used: number; slots: number; waitlisted_next_month: number }[])[0];
  return row
    ? { month: row.month, used: row.used, slots: row.slots, waitlistedNextMonth: row.waitlisted_next_month }
    : null;
}

export type TherapyManager = { id: string; name: string | null; email: string | null; hasAccess: boolean };

/** Every admin and whether they have Therapy Support access — the only
 * screen that shows the flag. */
export async function loadTherapyManagers(supabase: SupabaseServerClient): Promise<TherapyManager[]> {
  const { data, error } = await supabase.rpc("therapy_admin_managers");
  if (error) {
    console.error(`[therapy access] managers: ${error.message}`);
    return [];
  }
  return ((data ?? []) as { id: string; full_name: string | null; email: string | null; has_access: boolean }[]).map(
    (r) => ({ id: r.id, name: r.full_name, email: r.email, hasAccess: r.has_access }),
  );
}

export type TherapyAccessLogEntry = {
  id: number;
  accessedAt: string;
  action: "view" | "list";
  accessedByName: string;
  subjectName: string | null;
  requestId: number | null;
};

export async function loadTherapyAccessLog(supabase: SupabaseServerClient): Promise<TherapyAccessLogEntry[]> {
  const { data, error } = await supabase.rpc("therapy_admin_access_log", { p_limit: 100 });
  if (error) {
    console.error(`[therapy access] access log: ${error.message}`);
    return [];
  }
  return (
    (data ?? []) as {
      id: number;
      accessed_at: string;
      action: "view" | "list";
      accessed_by_name: string;
      subject_name: string | null;
      request_id: number | null;
    }[]
  ).map((r) => ({
    id: r.id,
    accessedAt: r.accessed_at,
    action: r.action,
    accessedByName: r.accessed_by_name,
    subjectName: r.subject_name,
    requestId: r.request_id,
  }));
}
