import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadMyHealthHistoryList } from "@/lib/health-access";
import { eventsNeedingHealthForm, formatHealthDate, healthFormCoversUntil } from "@/lib/health-requirements";
import { HEALTH_FORM_INTRO } from "@/lib/health-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function MedicalLoader() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");
  const userId = data.claims.sub as string;

  const [submissions, needed] = await Promise.all([
    loadMyHealthHistoryList(supabase),
    eventsNeedingHealthForm(supabase, userId),
  ]);
  // The newest submission is the one that counts (a correction is a new one).
  const latest = submissions[0] ?? null;
  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request.
  const now = Date.now();
  const coversUntil = latest ? healthFormCoversUntil(latest.signedAt) : null;
  const current = latest && coversUntil && coversUntil.getTime() > now ? latest : null;
  const neededNow = needed.filter((e) => !e.opensOn);
  const neededLater = needed.filter((e) => e.opensOn);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your health form</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {current && coversUntil ? (
            <p>
              Submitted {formatHealthDate(current.signedAt)}. It covers events starting before{" "}
              {formatHealthDate(coversUntil)}. Spotted a mistake, or something changed? Submit a new one: the
              newest counts.
            </p>
          ) : (
            <p>
              {latest ? "Your last health form has run out. " : "You don't have a health form on file yet. "}
              One is needed for retreats and other events that ask for it, whether you&apos;re attending or
              volunteering. Each one covers events starting in the 12 months after you sign it.
            </p>
          )}
          {neededNow.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
              Needed for:{" "}
              {neededNow.map((e) => `${e.name} (${e.dateRange})`).join("; ")}
            </div>
          )}
          {neededLater.map((e) => (
            <p key={e.eventId} className="text-muted-foreground">
              {e.name} is more than 12 months away, so its form can be filled in from {e.opensOn}.
            </p>
          ))}
          <div>
            <Button asChild variant={current ? "outline" : "default"}>
              <Link href="/protected/profile/medical/new">
                {current ? "Submit a new health form" : "Complete your health form"}
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
                    Signed {formatHealthDate(s.signedAt)}
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
            Each new form starts blank. You can look at an earlier one, but a new one is filled in fresh.
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
