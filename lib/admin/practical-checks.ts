import type { createClient } from "@/lib/supabase/server";
import { sortChecks, type PracticalCheck } from "@/lib/practical-checks";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** A person's practical checks, newest first (RLS: only for someone who can
 * record one for them), with recorders' names where readable. */
export async function loadPracticalChecks(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{ checks: PracticalCheck[]; recorderNames: Record<string, string> }> {
  const { data } = await supabase.from("practical_instruction_checks").select("*").eq("user_id", userId);
  const checks = sortChecks((data ?? []) as PracticalCheck[]);
  const ids = [...new Set(checks.map((c) => c.recorded_by).filter((v): v is string => Boolean(v)))];
  const { data: people } =
    ids.length > 0 ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids) : { data: [] };
  const recorderNames: Record<string, string> = {};
  for (const p of people ?? []) {
    recorderNames[p.id as string] = [p.first_name, p.last_name].filter(Boolean).join(" ");
  }
  return { checks, recorderNames };
}

/** The latest check per person, for a list of people (the roster). */
export async function loadLatestPracticalChecks(
  supabase: SupabaseServerClient,
  userIds: string[],
): Promise<Record<string, PracticalCheck>> {
  if (userIds.length === 0) return {};
  const { data } = await supabase.from("practical_instruction_checks").select("*").in("user_id", userIds);
  const latest: Record<string, PracticalCheck> = {};
  for (const check of sortChecks((data ?? []) as PracticalCheck[])) {
    if (!latest[check.user_id]) latest[check.user_id] = check;
  }
  return latest;
}
