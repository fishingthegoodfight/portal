import type { createAdminClient } from "@/lib/supabase/admin";
import type { AdminDigestSection } from "@/lib/email/templates";
import { getSiteUrl } from "@/lib/site-url";
import { formatDateInZone } from "@/lib/format-date";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The daily admin digest (app/api/cron/admin-digest): one email listing
 * everything that needs an admin's attention, section by section. Each
 * source returns its section plus how to mark its items as sent, so nothing
 * is listed twice and nothing is marked unless the email actually went out.
 *
 * To add a section (phase 3: pending reference checks), write another
 * DigestSource and add it to DIGEST_SOURCES in the order it should appear.
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

/** In the order the sections appear — most pressing first. */
export const DIGEST_SOURCES: DigestSource[] = [readyApplications];
