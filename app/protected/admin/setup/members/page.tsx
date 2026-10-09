import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { MemberSettingsForm } from "@/components/admin/member-settings-form";
import { MembersEmailSettingsForm } from "@/components/admin/members-email-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { activeChapters, loadChapters } from "@/lib/chapters";
import { memberSettingsFrom } from "@/lib/members";
import {
  loadMembersEmailSettings,
  loadOutreachCandidates,
  loadOutreachRecipientIds,
} from "@/lib/members-outreach-email";

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

/** The weekly outreach email's settings, and who gets each chapter's. */
async function EmailSettingsLoader() {
  const supabase = await createClient();
  const [settings, chapters, candidates, recipientIds] = await Promise.all([
    loadMembersEmailSettings(supabase),
    loadChapters(supabase),
    loadOutreachCandidates(supabase),
    loadOutreachRecipientIds(supabase),
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly outreach email</CardTitle>
        <p className="text-sm text-muted-foreground">
          Once a week, each chapter&apos;s list of who needs outreach, in the same sections as Members, goes to the
          person picked for it below. It&apos;s skipped for a chapter when nobody needs outreach. The admins
          (ADMIN_NOTIFICATION_EMAILS) get one summary of every chapter, with the full list for any chapter with
          nobody picked.
        </p>
      </CardHeader>
      <CardContent>
        <MembersEmailSettingsForm
          enabled={settings.enabled}
          weekday={settings.weekday}
          chapters={activeChapters(chapters).map((c) => {
            const list = candidates.get(c.name) ?? [];
            const picked = recipientIds.get(c.name) ?? "";
            return {
              chapter: c.name,
              // Someone picked who's no longer eligible shows as nobody.
              recipient: list.some((p) => p.userId === picked) ? picked : "",
              candidates: list.map((p) => ({ userId: p.userId, name: p.name })),
            };
          })}
        />
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
