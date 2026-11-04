import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadPartnerOverview, loadPartnerUsage } from "@/lib/therapy-access";
import { formatDateInZone } from "@/lib/format-date";
import { formatMonth, formatPlainDate } from "@/lib/therapy-support";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ZONE = "America/Denver";
const REQUEST = (id: number) => `/protected/admin/therapy/${id}`;

/** The partner office: this month's sessions against its monthly number,
 * who's waiting, and every active referral. Loading it is logged ("list"). */
async function PartnerLoader() {
  const supabase = await createClient();
  const [usage, result] = await Promise.all([loadPartnerUsage(supabase), loadPartnerOverview(supabase)]);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load the partner office: {result.error}</p>;
  const { waitlist, referrals } = result.data;

  return (
    <div className="flex flex-col gap-6">
      {usage && (
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <span className="text-sm text-muted-foreground">{formatMonth(usage.month)}</span>
          <span className={cn("text-2xl font-semibold tabular-nums", usage.used >= usage.slots && "text-amber-700 dark:text-amber-400")}>
            {usage.used} of {usage.slots} sessions used
          </span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn("h-full", usage.used >= usage.slots ? "bg-amber-500" : "bg-foreground")}
              style={{ width: `${usage.slots === 0 ? 100 : Math.min(100, (usage.used / usage.slots) * 100)}%` }}
            />
          </div>
          <span className="text-sm text-muted-foreground">
            Sessions logged with a date this month. Once it&apos;s full, new referrals are waitlisted for next month.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Waitlist ({waitlist.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {waitlist.length === 0 ? (
            <p className="text-muted-foreground">Nobody waiting.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {waitlist.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={REQUEST(w.id)} className="font-medium hover:underline">
                    {w.person}
                  </Link>
                  <span className="text-muted-foreground">
                    {[w.chapter, w.waitlist_month && `for ${formatMonth(w.waitlist_month)}`, `sent ${formatDateInZone(w.submitted_at, ZONE)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Open someone&apos;s request and refer them once there&apos;s room.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referrals ({referrals.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {referrals.length === 0 ? (
            <p className="text-muted-foreground">No active referrals.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {referrals.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-col">
                    <Link href={REQUEST(r.id)} className="font-medium hover:underline">
                      {r.person}
                    </Link>
                    <span className="text-muted-foreground">
                      {[r.chapter, r.referred_at && `referred ${formatDateInZone(r.referred_at, ZONE)}`, r.last_session && `last session ${formatPlainDate(r.last_session)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {r.sessions_used}/{r.sessions_approved} sessions
                    <span className="text-muted-foreground"> · {r.this_month} this month</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Log sessions from each person&apos;s request page.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PartnerOfficePage() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Partner office</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PartnerLoader />
      </Suspense>
    </div>
  );
}
