import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadTherapistSummary, loadTherapySettings } from "@/lib/therapy-access";
import { todayInZone } from "@/lib/format-date";
import { formatCents } from "@/lib/therapy-support";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { TherapistRecordForm } from "@/components/admin/therapy-therapist-forms";
import { Badge } from "@/components/ui/badge";

const BASE_PATH = "/protected/admin/therapy/therapists";
const EMPTY = { name: "", practice: "", email: "", phone: "", licenseType: "", licenseState: "" };

/** Every therapist: what's owed now, what's been paid in the year, and the
 * W-9 flag. No participant names, so not logged. */
async function TherapistsLoader({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yearParam } = await searchParams;
  const thisYear = Number(todayInZone("America/Denver").slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : thisYear;

  const supabase = await createClient();
  const [result, settings] = await Promise.all([loadTherapistSummary(supabase, year), loadTherapySettings(supabase)]);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load therapists: {result.error}</p>;
  const rows = result.data;
  const owed = rows.reduce((sum, r) => sum + r.unpaid_cents, 0);
  const flagged = rows.filter((r) => r.needs_w9).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border p-3 text-sm">
        <span>
          <span className="font-medium">Owed now:</span> {formatCents(owed)}
        </span>
        {flagged > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            {flagged} therapist{flagged === 1 ? "" : "s"} need{flagged === 1 ? "s" : ""} a W-9
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Payments in</span>
        <div role="group" aria-label="Year" className="flex flex-wrap gap-2">
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <FilterPill key={y} href={filterHref(BASE_PATH, { year: y === thisYear ? undefined : String(y) })} active={year === y}>
              {y}
            </FilterPill>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No therapists yet. They&apos;re added when a scholarship is approved, or here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.therapist_id}>
              <Link
                href={`${BASE_PATH}/${r.therapist_id}`}
                className="grid gap-2 rounded-md border p-3 hover:bg-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {[r.practice, r.license_type && `${r.license_type}${r.license_state ? ` (${r.license_state})` : ""}`, r.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm sm:justify-end">
                  {r.unpaid_sessions > 0 && (
                    <span className="tabular-nums">
                      Owed {formatCents(r.unpaid_cents)} ({r.unpaid_sessions} session{r.unpaid_sessions === 1 ? "" : "s"})
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">
                    Paid {formatCents(r.paid_cents)} in {year}
                  </span>
                  {r.needs_w9 ? (
                    <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">W-9 needed</Badge>
                  ) : (
                    r.w9_received && <Badge variant="outline">W-9 on file</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {settings && (
        <p className="text-xs text-muted-foreground">
          &quot;W-9 needed&quot;: paid {formatCents(settings.w9_threshold_cents)} or more in the year with no W-9 on
          file (the threshold is in Settings &amp; access).
        </p>
      )}
    </div>
  );
}

export default function TherapistsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">Therapists &amp; payments</h1>
        <TherapistRecordForm id={null} initial={EMPTY} buttonLabel="Add a therapist" />
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <TherapistsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
