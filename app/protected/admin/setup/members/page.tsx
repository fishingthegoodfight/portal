import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { MemberSettingsForm } from "@/components/admin/member-settings-form";
import { MembersEmailSettingsForm } from "@/components/admin/members-email-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activeChapters, loadChapters } from "@/lib/chapters";
import { memberSettingsFrom } from "@/lib/members";
import { loadEngagementLeads, loadMembersEmailSettings } from "@/lib/members-outreach-email";

async function SettingsLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").select("*").maybeSingle();
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load settings: {error.message}</p>;
  return (
    <Card>
      <CardContent className="pt-6">
        <MemberSettingsForm initial={memberSettingsFrom(data as Record<string, unknown> | null)} />
      </CardContent>
    </Card>
  );
}

/** The weekly outreach email's settings, and who each chapter's goes to. */
async function EmailSettingsLoader() {
  const supabase = await createClient();
  const [settings, { data: roleTypes }, chapters] = await Promise.all([
    loadMembersEmailSettings(supabase),
    supabase.from("volunteer_role_types").select("id, name").eq("leadership_team", true).order("sort_order"),
    loadChapters(supabase),
  ]);
  const leads = await loadEngagementLeads(supabase, settings.roleTypeId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly outreach email</CardTitle>
        <p className="text-sm text-muted-foreground">
          Once a week, each chapter&apos;s list of who needs outreach, in the same sections as Members, goes to the
          person in that role. It&apos;s skipped for a chapter when nobody needs outreach. The admins
          (ADMIN_NOTIFICATION_EMAILS) get one summary of every chapter, with the full list for any chapter that has
          nobody in the role.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <MembersEmailSettingsForm
          enabled={settings.enabled}
          weekday={settings.weekday}
          roleTypeId={settings.roleTypeId}
          roleTypes={(roleTypes ?? []).map((rt) => ({ id: rt.id as number, name: rt.name as string }))}
        />
        {settings.roleTypeId != null && (
          <div className="flex flex-col gap-2 border-t pt-4 text-sm">
            <span className="font-medium">Who gets each chapter&apos;s email</span>
            <ul className="flex flex-col gap-1">
              {activeChapters(chapters).map((c) => {
                const names = (leads.byChapter.get(c.name) ?? []).map((l) => l.name);
                return (
                  <li key={c.name}>
                    {c.name}:{" "}
                    {names.length > 0 ? (
                      names.join(", ")
                    ) : (
                      <span className="text-muted-foreground">nobody yet, so the admins get its list</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Approved volunteers approved for {leads.roleName ?? "the role"}, by home chapter. Approve someone for
              it on their volunteer record or contact profile.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MemberSettingsPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Members</h1>
        <p className="text-sm text-muted-foreground">
          How Members works out engagement bands and who needs outreach. Someone new needs one welcome, and someone
          who came once gets one nudge to come back if they haven&apos;t returned in 8 weeks. A regular who stops coming needs outreach sooner than their band
          alone would say. A check-in is any event someone
          was checked in at, as an attendee or a volunteer, including imported attendance. Who can see Members is set
          by role: admins, chapter leads, and anyone approved for a role type ticked &quot;Chapter leadership team&quot;
          (Volunteers → Role types).
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SettingsLoader />
      </Suspense>
      <Suspense fallback={null}>
        <EmailSettingsLoader />
      </Suspense>
    </div>
  );
}
