import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { loadPartnerUsage, loadSupportRequests } from "@/lib/therapy-access";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateInZone } from "@/lib/format-date";
import {
  formatMonth,
  isSupportProgram,
  isSupportStatus,
  PROGRAM_LABELS,
  STATUS_LABELS,
  SUPPORT_PROGRAMS,
  SUPPORT_STATUSES,
  type SupportProgram,
  type SupportStatus,
} from "@/lib/therapy-support";
import { cn } from "@/lib/utils";

const BASE_PATH = "/protected/admin/therapy";
const ZONE = "America/Denver";

type SearchParams = { program?: string; status?: string };

/** "open" (submitted or waitlisted: needs a decision) is the default. */
type StatusFilter = SupportStatus | "open" | "all";
const OPEN: SupportStatus[] = ["submitted", "waitlisted"];

async function RequestsLoader({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { program: programParam, status: statusParam } = await searchParams;
  const program: SupportProgram | null = isSupportProgram(programParam) ? programParam : null;
  const status: StatusFilter = statusParam === "all" || isSupportStatus(statusParam) ? statusParam : "open";

  const supabase = await createClient();
  // Loading the list is logged ("list") by the database.
  const [result, usage] = await Promise.all([loadSupportRequests(supabase), loadPartnerUsage(supabase)]);
  if (!result.ok) return <p className="text-sm text-red-500">Couldn&apos;t load requests: {result.error}</p>;

  const inProgram = result.data.filter((r) => !program || r.program === program);
  const rows = inProgram.filter(
    (r) => status === "all" || (status === "open" ? OPEN.includes(r.status) : r.status === status),
  );
  const counts: Partial<Record<SupportStatus, number>> = {};
  for (const r of inProgram) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const href = (next: { program?: SupportProgram | null; status?: StatusFilter }) => {
    const p = next.program === undefined ? program : next.program;
    const s = next.status ?? status;
    return filterHref(BASE_PATH, { program: p ?? undefined, status: s === "open" ? undefined : s });
  };

  return (
    <div className="flex flex-col gap-6">
      {usage && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border p-3 text-sm">
          <span className="font-medium">Partner office, {formatMonth(usage.month)}</span>
          <span className={cn("tabular-nums", usage.used >= usage.slots && "text-amber-700 dark:text-amber-400")}>
            {usage.used} of {usage.slots} sessions used
          </span>
          <span className="tabular-nums text-muted-foreground">{usage.waitlistedNextMonth} waitlisted for next month</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Program</span>
          <div role="group" aria-label="Filter by program" className="flex flex-wrap gap-2">
            <FilterPill href={href({ program: null })} active={!program}>
              Both
            </FilterPill>
            {SUPPORT_PROGRAMS.map((p) => (
              <FilterPill key={p} href={href({ program: p })} active={program === p}>
                {PROGRAM_LABELS[p]}
              </FilterPill>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
            <FilterPill href={href({ status: "open" })} active={status === "open"}>
              Needs a decision
            </FilterPill>
            {SUPPORT_STATUSES.map((s) => (
              <FilterPill key={s} href={href({ status: s })} active={status === s}>
                {STATUS_LABELS[s]} ({counts[s] ?? 0})
              </FilterPill>
            ))}
            <FilterPill href={href({ status: "all" })} active={status === "all"}>
              All
            </FilterPill>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`${BASE_PATH}/${r.id}`}
                className="grid gap-2 rounded-md border p-3 hover:bg-accent sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium [overflow-wrap:anywhere]">{r.fullName}</span>
                  <span className="text-sm text-muted-foreground">
                    {[
                      PROGRAM_LABELS[r.program] + (r.renewalOf ? " renewal" : ""),
                      r.chapter,
                      `sent ${formatDateInZone(r.submittedAt, ZONE)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm sm:justify-end">
                  {r.userId &&
                    (r.checkins === 0 ? (
                      <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500">No check-ins</Badge>
                    ) : (
                      <span className="text-muted-foreground" title="Events checked in at, and the most recent">
                        {r.checkins} check-in{r.checkins === 1 ? "" : "s"}
                        {r.lastCheckin && `, last ${formatDateInZone(r.lastCheckin, ZONE)}`}
                      </span>
                    ))}
                  {r.priorApprovals > 0 && <Badge variant="outline">{r.priorApprovals} prior approval{r.priorApprovals === 1 ? "" : "s"}</Badge>}
                  {r.sessionsApproved !== null && (
                    <span className="tabular-nums">
                      {r.sessionsUsed}/{r.sessionsApproved} sessions
                    </span>
                  )}
                  {r.status === "waitlisted" && r.waitlistMonth && (
                    <span className="text-muted-foreground">for {formatMonth(r.waitlistMonth)}</span>
                  )}
                  <Badge variant={OPEN.includes(r.status) ? "default" : "secondary"}>{STATUS_LABELS[r.status]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TherapySupportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Therapy Support</h1>
          <p className="text-sm text-muted-foreground">
            Visible only to admins with Therapy Support access. Every view of someone&apos;s request is logged.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`${BASE_PATH}/settings`}>Settings &amp; access</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <RequestsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
