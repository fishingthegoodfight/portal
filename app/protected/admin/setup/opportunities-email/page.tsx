import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { OpportunitiesEmailSettingsForm } from "@/components/admin/opportunities-email-settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { dateInZone, SCHEDULE_ZONE } from "@/lib/opportunities-schedule";

async function SettingsLoader() {
  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from("app_settings")
    .select("opportunities_email_enabled, opportunities_email_anchor, opportunities_email_weekday")
    .maybeSingle();
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load settings: {error.message}</p>;
  return (
    <Card>
      <CardContent className="pt-6">
        <OpportunitiesEmailSettingsForm
          enabled={settings?.opportunities_email_enabled === true}
          anchor={(settings?.opportunities_email_anchor as string | undefined) ?? "2026-10-06"}
          weekday={(settings?.opportunities_email_weekday as number | undefined) ?? 2}
          today={dateInZone(new Date(), SCHEDULE_ZONE)}
        />
      </CardContent>
    </Card>
  );
}

export default function OpportunitiesEmailSettingsPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Volunteer opportunities email</h1>
        <p className="text-sm text-muted-foreground">
          Every two weeks, each approved, registered volunteer gets the open roles they&apos;re approved
          for at events in their region over the next six weeks — every region if they have no local
          chapter. Anyone with nothing to show gets nothing. Approved volunteers who haven&apos;t
          registered get a short reminder to finish instead. Volunteers can turn it off on their
          profile or from the email.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SettingsLoader />
      </Suspense>
    </div>
  );
}
