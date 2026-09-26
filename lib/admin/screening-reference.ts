import type { createClient } from "@/lib/supabase/server";
import { formatDateInZone } from "@/lib/format-date";
import { interestAreaNames } from "@/lib/volunteer-applications";
import type { ScreeningReference } from "@/components/admin/screening-form";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Everything the screening form quotes from the application — interest
 * areas, the retreat answer, attendance, and the answers each section shows
 * — plus the active role types for the recommendation. Read as a reviewer
 * (RLS decides), for the new and edit screening pages.
 */
export async function loadScreeningReference(
  supabase: SupabaseServerClient,
  applicationId: number,
): Promise<{ fullName: string; status: string; reference: ScreeningReference; roleTypes: { id: number; name: string }[] } | null> {
  const { data: app } = await supabase
    .from("volunteer_applications")
    .select(
      "full_name, status, interested_in_retreats, interest_area_ids, interest_other, why_volunteer, hope_to_get, mission_connection, years_fly_fishing, fishing_frequency, water_fished, has_taught_or_guided, taught_details, beginner_comfort",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return null;

  const [{ data: areas }, { data: attendance }, { data: events }, { data: roleTypes }] = await Promise.all([
    supabase.from("volunteer_interest_areas").select("id, label, description, sort_order").order("sort_order"),
    supabase.rpc("volunteer_application_attendance", { p_application_ids: [applicationId] }),
    supabase.rpc("volunteer_application_attended_events", { p_application_id: applicationId }),
    supabase.from("volunteer_role_types").select("id, name").eq("active", true).order("sort_order"),
  ]);

  const areaIds = (app.interest_area_ids as number[] | null) ?? [];
  return {
    fullName: app.full_name as string,
    status: app.status as string,
    roleTypes: (roleTypes ?? []) as { id: number; name: string }[],
    reference: {
      interestAreaNames: interestAreaNames(
        (areas ?? []) as { id: number; label: string; description: string | null }[],
        areaIds,
        (app.interest_other as string | null) ?? null,
      ),
      interestedInRetreats: Boolean(app.interested_in_retreats),
      attendedTotal: ((attendance ?? []) as { attended: number }[])[0]?.attended ?? 0,
      attendedEvents: ((events ?? []) as { name: string; starts_at: string; timezone: string }[])
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
        .map((e) => ({ name: e.name, date: formatDateInZone(e.starts_at, e.timezone) })),
      answers: {
        why_volunteer: app.why_volunteer as string,
        hope_to_get: app.hope_to_get as string,
        mission_connection: app.mission_connection as string | null,
        years_fly_fishing: app.years_fly_fishing as string,
        fishing_frequency: app.fishing_frequency as string | null,
        water_fished: app.water_fished as string,
        has_taught_or_guided: Boolean(app.has_taught_or_guided),
        taught_details: app.taught_details as string | null,
        beginner_comfort: app.beginner_comfort as number,
      },
    },
  };
}
