import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadMyHealthHistoryList } from "@/lib/health-access";
import { eventsNeedingHealthForm, healthFormYearFor } from "@/lib/health-requirements";
import { HEALTH_FORM_INTRO } from "@/lib/health-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const signedDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(iso));

async function MedicalLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  const userId = data.claims.sub as string;

  const [{ data: profile }, submissions, needed] = await Promise.all([
    supabase.from("profiles").select("chapter").eq("id", userId).maybeSingle(),
    loadMyHealthHistoryList(supabase),
    eventsNeedingHealthForm(supabase, userId),
  ]);
  const year = healthFormYearFor(profile?.chapter as string | null | undefined);
  const current = submissions.find((s) => s.year === year);
  const neededNow = needed.filter((e) => !e.opensLater);
  const neededLater = needed.filter((e) => e.opensLater);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{year} health form</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {current ? (
            <p>
              Submitted {signedDate(current.signedAt)}. It covers your events through December 31,{" "}
              {year}. Spotted a mistake? Submit a corrected one — the newest counts.
            </p>
          ) : (
            <p>
              You haven&apos;t completed your {year} health form yet. It&apos;s needed once a year for
              retreats and other events that ask for it — whether you&apos;re attending or
              volunteering.
            </p>
          )}
          {neededNow.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
              Needed for:{" "}
              {neededNow.map((e) => `${e.name} (${e.dateRange})`).join("; ")}
            </div>
          )}
          {neededLater.length > 0 && (
            <p className="text-muted-foreground">
              {neededLater.map((e) => e.name).join(", ")} {neededLater.length === 1 ? "is" : "are"} in{" "}
              {neededLater[0].year}, so {neededLater.length === 1 ? "it needs" : "they need"} a{" "}
              {neededLater[0].year} form — that opens on January 1.
            </p>
          )}
          <div>
            <Button asChild variant={current ? "outline" : "default"}>
              <Link href="/protected/profile/medical/new">
                {current ? `Submit a corrected ${year} form` : `Complete your ${year} health form`}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your past submissions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {submissions.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {submissions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0">
                  <span>
                    {s.year} form · signed {signedDate(s.signedAt)}
                    {s.id === current?.id && <span className="text-muted-foreground"> (current)</span>}
                  </span>
                  <Link href={`/protected/profile/medical/${s.id}`} className="underline underline-offset-4">
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Each year&apos;s form starts blank — you can look at last year&apos;s, but this year&apos;s is
            filled in fresh.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MedicalPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Medical information</h1>
        <p className="text-sm text-muted-foreground">{HEALTH_FORM_INTRO}</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <MedicalLoader />
      </Suspense>
    </div>
  );
}
