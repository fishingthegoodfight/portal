import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { ApplicationSettingsForm } from "@/components/admin/application-settings-form";
import { Card, CardContent } from "@/components/ui/card";

async function SettingsLoader() {
  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from("app_settings")
    .select("min_events_before_screening, screening_scheduling_url")
    .maybeSingle();
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load settings: {error.message}</p>;
  return (
    <Card>
      <CardContent className="pt-6">
        <ApplicationSettingsForm
          minEvents={(settings?.min_events_before_screening as number | undefined) ?? 2}
          schedulingUrl={(settings?.screening_scheduling_url as string | null) ?? ""}
        />
      </CardContent>
    </Card>
  );
}

export default function ApplicationSettingsPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Volunteer applications</h1>
        <p className="text-sm text-muted-foreground">Settings for the volunteer application pipeline.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SettingsLoader />
      </Suspense>
    </div>
  );
}
