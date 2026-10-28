import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadTherapyAccessLog, loadTherapyManagers, loadTherapySettings } from "@/lib/therapy-access";
import { formatEventInstant } from "@/lib/format-date";
import { TherapyManagers, TherapySettingsForm } from "@/components/admin/therapy-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ZONE = "America/Denver";

/**
 * Therapy Support's own settings, kept here rather than on Setup: Setup is
 * open to every admin, and app_settings is readable by every signed-in
 * person. Also who has access (the only place the flag is shown or
 * changed) and the access log.
 */
async function SettingsLoader() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const [settings, managers, log] = await Promise.all([
    loadTherapySettings(supabase),
    loadTherapyManagers(supabase),
    loadTherapyAccessLog(supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {settings ? (
            <TherapySettingsForm
              rateCents={settings.scholarship_rate_cents}
              partnerMonthlySessions={settings.partner_monthly_sessions}
            />
          ) : (
            <p className="text-sm text-red-500">Couldn&apos;t load the settings.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who has access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Only admins can have it, and only someone who already has it can give it. Being an admin
            isn&apos;t enough on its own. Access ends automatically if someone stops being an admin.
          </p>
          <TherapyManagers managers={managers} currentUserId={(claims?.claims.sub as string | undefined) ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access log</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            The latest 100 entries: every time someone&apos;s request was opened, and every time the list
            was loaded. Nobody can change or remove an entry.
          </p>
          {log.length === 0 ? (
            <p className="text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {log.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>
                    {entry.accessedByName}{" "}
                    {entry.action === "list" ? (
                      "loaded the request list"
                    ) : (
                      <>
                        opened{" "}
                        {entry.requestId ? (
                          <Link href={`/protected/admin/therapy/${entry.requestId}`} className="underline underline-offset-4">
                            {entry.subjectName ?? "a request"}
                          </Link>
                        ) : (
                          (entry.subjectName ?? "a request")
                        )}
                      </>
                    )}
                  </span>
                  <span className="text-muted-foreground">{formatEventInstant(entry.accessedAt, ZONE)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TherapySettingsPage() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/protected/admin/therapy" className="text-sm text-muted-foreground hover:underline">
          ← Therapy Support
        </Link>
        <h1 className="text-2xl font-bold">Settings &amp; access</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <SettingsLoader />
      </Suspense>
    </div>
  );
}
