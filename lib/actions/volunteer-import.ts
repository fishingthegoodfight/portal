"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  checkImportRow,
  IMPORT_CHUNK_SIZE,
  IMPORT_MAX_ROWS,
  type CheckedImportRow,
  type ImportRowInput,
} from "@/lib/volunteer-import";

/**
 * The "Import volunteers" screen's database side. Nothing here sends email:
 * a new person gets an auth user created with no password, unconfirmed
 * (auth.admin.createUser never emails), and a volunteers row straight at
 * 'approved' — the same shape as createApprovedVolunteerAction's backfill.
 * They can't sign in until an admin sends a portal invite
 * (sendPortalInvitesAction). See the 2026-09-26 "Volunteer roster import"
 * entry in schema-changes.sql.
 *
 * Every row is re-checked here (checkImportRow + the email lookups) for
 * both the preview and the write — the write never trusts the preview it
 * was confirmed from.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImportPlanAction = "create" | "attach" | "skip" | "problem";

export type ImportPlanRow = CheckedImportRow & {
  action: ImportPlanAction;
  /** attach/skip: the existing profile's name, for the preview. */
  existingName: string;
  /** attach: the blank profile fields this row will fill (labels). */
  fills: string[];
};

type ExistingProfile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  chapter: string | null;
};

type ImportContext = {
  activeRoleTypes: { id: number; name: string }[];
  profileByEmail: Map<string, ExistingProfile>;
  volunteerIds: Set<string>;
};

async function loadContext(supabase: ServerClient, emails: string[]): Promise<ImportContext | { error: string }> {
  const { data: roleTypes, error: roleError } = await supabase
    .from("volunteer_role_types")
    .select("id, name")
    .eq("active", true);
  if (roleError) return { error: roleError.message };

  // Emails are compared lowercased; profiles.email isn't guaranteed to be,
  // so this reads every profile's email (paged — PostgREST caps a response
  // at 1000 rows) rather than an exact-match .in().
  const wanted = new Set(emails);
  const profileByEmail = new Map<string, ExistingProfile>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name, phone, chapter")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) return { error: error.message };
    for (const p of (data ?? []) as ExistingProfile[]) {
      const email = (p.email ?? "").trim().toLowerCase();
      if (email && wanted.has(email)) profileByEmail.set(email, p);
    }
    if ((data ?? []).length < pageSize) break;
  }

  const profileIds = [...profileByEmail.values()].map((p) => p.id);
  const volunteerIds = new Set<string>();
  for (let i = 0; i < profileIds.length; i += 200) {
    const { data, error } = await supabase
      .from("volunteers")
      .select("user_id")
      .in("user_id", profileIds.slice(i, i + 200));
    if (error) return { error: error.message };
    for (const v of data ?? []) volunteerIds.add(v.user_id as string);
  }

  return {
    activeRoleTypes: (roleTypes ?? []) as { id: number; name: string }[],
    profileByEmail,
    volunteerIds,
  };
}

function isBlank(value: string | null | undefined) {
  return !value || !value.trim();
}

/** Which of a matched profile's blank fields this row would fill — never
 * overwrites anything the person (or anyone) already entered. */
function profileFills(row: CheckedImportRow, profile: ExistingProfile) {
  const update: Record<string, string> = {};
  const labels: string[] = [];
  if (row.firstName && isBlank(profile.first_name)) {
    update.first_name = row.firstName;
    labels.push("first name");
  }
  if (row.lastName && isBlank(profile.last_name)) {
    update.last_name = row.lastName;
    labels.push("last name");
  }
  if (row.phone && isBlank(profile.phone)) {
    update.phone = row.phone;
    labels.push("phone");
  }
  if (row.chapter && isBlank(profile.chapter)) {
    update.chapter = row.chapter;
    labels.push("home chapter");
  }
  return { update, labels };
}

function planRows(rows: ImportRowInput[], ctx: ImportContext): ImportPlanRow[] {
  const firstRowByEmail = new Map<string, number>();
  return rows.map((input) => {
    const row = checkImportRow(input, ctx.activeRoleTypes);
    const plan: ImportPlanRow = { ...row, action: "problem", existingName: "", fills: [] };
    if (row.email) {
      const first = firstRowByEmail.get(row.email);
      if (first != null) row.problems.push(`Same email as row ${first}`);
      else firstRowByEmail.set(row.email, row.rowNumber);
    }
    if (row.problems.length > 0) return plan;

    const profile = ctx.profileByEmail.get(row.email);
    if (!profile) return { ...plan, action: "create" };
    plan.existingName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    if (ctx.volunteerIds.has(profile.id)) return { ...plan, action: "skip" };
    return { ...plan, action: "attach", fills: profileFills(row, profile).labels };
  });
}

export type PreviewImportResult = { ok: true; plan: ImportPlanRow[] } | { ok: false; error: string };

/** Classifies every row without writing anything. */
export async function previewVolunteerImportAction(rows: ImportRowInput[]): Promise<PreviewImportResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (rows.length === 0) return { ok: false, error: "The file has no data rows" };
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `At most ${IMPORT_MAX_ROWS} rows per import — split the file` };
  }

  const ctx = await loadContext(supabase, rows.map((r) => r.email.trim().toLowerCase()));
  if ("error" in ctx) return { ok: false, error: ctx.error };
  return { ok: true, plan: planRows(rows, ctx) };
}

export type ImportRowOutcome = {
  rowNumber: number;
  email: string;
  name: string;
  outcome: "created" | "updated" | "skipped" | "failed";
  /** failed/skipped: why. created/updated: a part that didn't save. */
  message: string;
};

export type ImportChunkResult = { ok: true; outcomes: ImportRowOutcome[] } | { ok: false; error: string };

/**
 * Writes one chunk of confirmed rows (the client sends them
 * IMPORT_CHUNK_SIZE at a time). Each row is re-planned first; a row that
 * now has a problem or already has a volunteer record is failed/skipped,
 * not written. Per row: the account (new person only), blank profile
 * fields, the volunteers row at 'approved' with joined_on, role approvals,
 * notes. A failure before the volunteers row exists fails the row; after
 * it, the row counts as imported with a message saying what didn't save —
 * a re-run would skip it as already a volunteer.
 */
export async function importVolunteerChunkAction(rows: ImportRowInput[]): Promise<ImportChunkResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  if (rows.length > IMPORT_CHUNK_SIZE) return { ok: false, error: "Too many rows in one request" };

  const ctx = await loadContext(supabase, rows.map((r) => r.email.trim().toLowerCase()));
  if ("error" in ctx) return { ok: false, error: ctx.error };

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Admin client unavailable" };
  }

  const outcomes: ImportRowOutcome[] = [];
  for (const row of planRows(rows, ctx)) {
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || row.existingName;
    const base = { rowNumber: row.rowNumber, email: row.email, name };

    if (row.action === "problem") {
      outcomes.push({ ...base, outcome: "failed", message: row.problems.join("; ") });
      continue;
    }
    if (row.action === "skip") {
      outcomes.push({ ...base, outcome: "skipped", message: "Already has a volunteer record — left as is" });
      continue;
    }

    let userId: string;
    if (row.action === "create") {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: row.email,
        email_confirm: false,
        user_metadata: { first_name: row.firstName, last_name: row.lastName },
      });
      if (createError || !created?.user) {
        outcomes.push({
          ...base,
          outcome: "failed",
          message: `Couldn't create the account: ${createError?.message ?? "unknown error"}`,
        });
        continue;
      }
      userId = created.user.id;
      // handle_new_user() only copies id/email/directory_opt_in.
      const profileUpdate: Record<string, string> = { email: row.email };
      if (row.firstName) profileUpdate.first_name = row.firstName;
      if (row.lastName) profileUpdate.last_name = row.lastName;
      if (row.phone) profileUpdate.phone = row.phone;
      if (row.chapter) profileUpdate.chapter = row.chapter;
      const { error: profileError } = await adminClient.from("profiles").update(profileUpdate).eq("id", userId);
      if (profileError) {
        outcomes.push({
          ...base,
          outcome: "failed",
          message: `The account was created but the profile didn't save (${profileError.message}). Re-running this row will attach to it.`,
        });
        continue;
      }
    } else {
      const profile = ctx.profileByEmail.get(row.email)!;
      userId = profile.id;
      const { update } = profileFills(row, profile);
      if (Object.keys(update).length > 0) {
        const { error: fillError } = await adminClient.from("profiles").update(update).eq("id", userId);
        if (fillError) {
          outcomes.push({ ...base, outcome: "failed", message: `Profile update failed: ${fillError.message}` });
          continue;
        }
      }
    }

    const now = new Date().toISOString();
    const { error: volunteerError } = await supabase.from("volunteers").insert({
      user_id: userId,
      status: "approved",
      approved_at: now,
      joined_on: row.joinedOn || null,
    });
    if (volunteerError) {
      // 23505 = a volunteer record appeared since the check (another import
      // or an invite at the same moment).
      outcomes.push(
        volunteerError.code === "23505"
          ? { ...base, outcome: "skipped", message: "Already has a volunteer record — left as is" }
          : { ...base, outcome: "failed", message: `Volunteer record didn't save: ${volunteerError.message}` },
      );
      continue;
    }

    const unsaved: string[] = [];
    if (row.roleTypeIds.length > 0) {
      const { error: rolesError } = await supabase.from("volunteer_role_approvals").insert(
        row.roleTypeIds.map((roleTypeId) => ({
          volunteer_id: userId,
          role_type_id: roleTypeId,
          approved_by: adminCheck.actor.userId,
          approved_at: now,
        })),
      );
      if (rolesError) unsaved.push(`roles (${rolesError.message}) — approve them on their page`);
    }
    if (row.notes) {
      const { error: notesError } = await supabase.from("volunteer_notes").insert({
        volunteer_id: userId,
        notes: row.notes,
        updated_by: adminCheck.actor.userId,
        updated_at: now,
      });
      if (notesError) unsaved.push(`notes (${notesError.message}) — add them on their page`);
    }

    outcomes.push({
      ...base,
      outcome: row.action === "create" ? "created" : "updated",
      message: unsaved.length > 0 ? `Imported, but these didn't save: ${unsaved.join("; ")}` : "",
    });
  }

  return { ok: true, outcomes };
}

export type FinishImportResult = { ok: true; ref1Changed: number } | { ok: false; error: string };

/** After the last chunk: re-checks reference 1 on applications still in
 * progress against the roster as it now stands (refresh_ref1_matches). */
export async function finishVolunteerImportAction(): Promise<FinishImportResult> {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if ("error" in adminCheck) return { ok: false, error: adminCheck.error };
  const { data, error } = await supabase.rpc("refresh_ref1_matches");
  if (error) return { ok: false, error: error.message };
  return { ok: true, ref1Changed: (data as number | null) ?? 0 };
}
