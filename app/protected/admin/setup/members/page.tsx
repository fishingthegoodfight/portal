import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { MemberSettingsForm } from "@/components/admin/member-settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { memberSettingsFrom } from "@/lib/members";

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
    </div>
  );
}
